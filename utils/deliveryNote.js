/**
 * ============================================================
 *  80mm 热敏纸 — 送货单打印模板（独立模块）
 *  v1.1  2026-05-25
 * ============================================================
 *
 * 【文件说明】
 *   本文件是一个完全独立的打印排版模块，不依赖任何业务代码。
 *   复制到任何微信小程序项目的 utils/ 目录下即可使用。
 *   注意：调用方需自行实现中文 GBK 编码（见下文"蓝牙对象要求"）。
 *
 * 【使用方式】
 *
 *   // 1. 引入模块
 *   const deliveryNote = require('./utils/deliveryNote.js');
 *
 *   // 2. 准备好蓝牙通信对象（需实现 sendData 和 sendText）
 *   // 3. 准备好送货单数据
 *   // 4. 调用打印
 *
 *   deliveryNote.print(bluetooth, {
 *     title:       '东莞市维俊食品送货单',      // 标题（居中、倍宽倍高、加粗）
 *     orderNo:     'NO.2600795',                // 单号（居中）
 *     phones: [                                 // 联系信息（左对齐，可多行）
 *       '订货电话: 18122884991  18122914891',
 *       '微    信: W18122914891',
 *       '投诉电话: 13694950666',
 *     ],
 *     customer:    '永辉超市(长安店)',           // 收货单位
 *     date:        '2026年5月22日',              // 日期
 *     products: [                                // 商品列表
 *       {
 *         barcode: '6970618570049',             // 条码（可选，不传则不打印）
 *         name:    '蒙牛纯牛奶 946ml',           // 品名+规格
 *         qty:     2,                            // 数量
 *         unit:    '箱',                         // 单位
 *         price:   45.00,                        // 单价（元）
 *         // 金额自动计算 = qty × price
 *       },
 *       // ... 更多商品
 *     ],
 *     deliveryMan: '李伟',                       // 送货人
 *     // receiver 不传则默认打印 "________" 供客户签字
 *   });
 *
 * 【蓝牙对象要求】
 *   调用方传入的 ble 对象必须提供以下两个方法：
 *
 *     ble.sendData(ArrayBuffer)
 *       → 发送 ESC/POS 控制指令（不经过 GBK 编码，原样发送）
 *
 *     ble.sendText(string)
 *       → 发送文本内容（方法内部需自行实现 GBK 编码后再发送）
 *
 * 【打印效果预览】
 *
 *   ==================================================
 *           东莞市维俊食品送货单
 *
 *                NO.2600795
 *   ==================================================
 *   订货电话: 18122884991  18122914891
 *   微    信: W18122914891
 *   投诉电话: 13694950666
 *   --------------------------------------------------
 *   收货单位: 永辉超市(长安店)
 *   日    期: 2026年5月22日
 *   --------------------------------------------------
 *   品名                  数量    单价     金额
 *   --------------------------------------------------
 *   蒙牛纯牛奶 946ml      2箱     45.00    90.00
 *   6970618570049
 *   白胡椒粉 2500g        1袋     68.00    68.00
 *   6970713990711
 *   ...
 *   --------------------------------------------------
 *   合计: 42件          金额: 790.90元
 *   ==================================================
 *     人民币(大写): 柒佰玖拾元玖角整
 *   ==================================================
 *   送货人: 李伟           收货人: ________
 *   签收日期: ____年____月____日
 *
 * 【依赖说明】
 *   本模块不依赖任何第三方 npm 包。
 *   如果调用方的 sendText 已经内置了 GBK 编码，则无需额外引入 gbk.min.js。
 *   本模块内部不再做 GBK 编码，编码职责完全交给调用方。
 */

// ===================================================================
//  第一部分：ESC/POS 指令构建
//  说明：热敏打印机通过 ESC/POS 控制码来控制字体、对齐、加粗等。
//  每个指令返回一个 ArrayBuffer，由 ble.sendData() 发送。
// ===================================================================

/**
 * 将多个字节组装成一个 ArrayBuffer
 * 用法：makeESC(0x1B, 0x40) → 打印机初始化指令
 */
function makeESC() {
  var buf = new ArrayBuffer(arguments.length);
  var view = new DataView(buf);
  for (var i = 0; i < arguments.length; i++) view.setUint8(i, arguments[i]);
  return buf;
}

// --- 打印机基础控制 ---

function init()       { return makeESC(0x1B, 0x40); }  // ESC @  初始化打印机（每次打印前必须调用）
function feed(n)      { return makeESC(0x1B, 0x64, Math.min(n || 4, 255)); }  // ESC d  走纸 n 行

// --- 对齐方式 ---
// 说明：发送对齐指令后，后续所有文字都按此对齐，直到发送新的对齐指令。

function alignLeft()  { return makeESC(0x1B, 0x61, 0x00); }  // ESC a 0  左对齐
function alignCenter(){ return makeESC(0x1B, 0x61, 0x01); }  // ESC a 1  居中对齐
function alignRight() { return makeESC(0x1B, 0x61, 0x02); }  // ESC a 2  右对齐

// --- 加粗 ---

function boldOn()     { return makeESC(0x1B, 0x45, 0x01); }  // ESC E 1  加粗开
function boldOff()    { return makeESC(0x1B, 0x45, 0x00); }  // ESC E 0  加粗关

// --- 字体缩放 ---
// 说明：GS ! n  低4位=纵向倍数，高4位=横向倍数
//       0x00=正常  0x10=倍宽  0x01=倍高  0x11=倍宽倍高

function normalSize() { return makeESC(0x1D, 0x21, 0x00); }  // 恢复正常大小
function doubleWH()   { return makeESC(0x1D, 0x21, 0x11); }  // 倍宽+倍高（标题用）
function doubleW()    { return makeESC(0x1D, 0x21, 0x10); }  // 仅倍宽
function doubleH()    { return makeESC(0x1D, 0x21, 0x01); }  // 仅倍高


// ===================================================================
//  第二部分：排版常量（针对 80mm 纸宽）
//  说明：80mm 热敏纸的打印区域约为 72mm = 576 点。
//        标准 ASCII 字符宽 12 点，每行可印 48 个 ASCII 字符。
//        中文字符宽 24 点，相当于 2 个 ASCII 字符位。
//
//  以下常量定义各列的"字符位"起始位置（单位：ASCII字符宽）。
//  修改这些值可以调整列宽分配。
// ===================================================================

var TOTAL_COL    = 48;   // 每行总字符位数（80mm 纸 = 48 个 ASCII 字符）
var NAME_COL     = 24;   // 品名列宽度（占 24 个字符位 = 12 个中文）
var QTY_COL      = 6;    // 数量列宽度（占 6 个字符位）
var PRICE_COL    = 10;   // 单价列宽度（占 10 个字符位）

// 各列的起始字符位置（从 0 开始计算）
var QTY_START    = NAME_COL;                  // 数量列起始位 = 24
var PRICE_START  = QTY_START + QTY_COL;       // 单价列起始位 = 30
var AMT_START    = PRICE_START + PRICE_COL;   // 金额列起始位 = 40（右侧剩余 8 位给金额）


// ===================================================================
//  第三部分：排版辅助函数
// ===================================================================

/**
 * 重复字符 n 次
 * 用途：生成填充空格对齐列
 * 示例：repeatStr(' ', 5) → "     "（5个空格）
 */
function repeatStr(ch, n) {
  return new Array(n + 1).join(ch);
}

/**
 * 测量字符串在热敏纸上的实际"字符位宽度"
 *
 * 规则：
 *   - ASCII 字符（码点 ≤ 127）：占 1 个字符位
 *   - 中文字符（码点 > 127，GBK 双字节）：占 2 个字符位
 *
 * 示例：
 *   measureWidth("ABC")       → 3
 *   measureWidth("品名")       → 4
 *   measureWidth("牛奶 946ml") → 13（牛奶=4 + 空格=1 + 946ml=5 = 10...）
 *                                 牛奶(4) + 空格(1) + 9(1)+4(1)+6(1)+m(1)+l(1) = 10
 */
function measureWidth(str) {
  var w = 0;
  for (var i = 0; i < str.length; i++) {
    w += (str.charCodeAt(i) > 127) ? 2 : 1;
  }
  return w;
}

/**
 * 构建表头行
 * 输出格式：
 *   品名[空格...]数量[空格...]单价[空格...]金额
 *
 * 各列标题精确对齐到数据列的上方：
 *   "品名" 对齐到 NAME_COL 起始 (0)
 *   "数量" 对齐到 QTY_START     (24)
 *   "单价" 对齐到 PRICE_START   (30)
 *   "金额" 对齐到 AMT_START     (40)
 */
function buildHeader() {
  var s = '品名';
  s += repeatStr(' ', NAME_COL - 4);                       // 品名(4宽) → 数量(位置24)
  s += '数量';
  s += repeatStr(' ', PRICE_START - (NAME_COL + 4));       // 数量(4宽) → 单价(位置30)
  s += '单价';
  s += repeatStr(' ', AMT_START - (PRICE_START + 4));      // 单价(4宽) → 金额(位置40)
  s += '金额';
  return s;
}

/**
 * 构建单行产品数据
 *
 * 参数：
 *   name    - 品名+规格（如 "蒙牛纯牛奶 946ml"）
 *   qtyStr  - 数量+单位（如 "2箱"）
 *   priceStr- 单价（已格式化，如 "45.00"）
 *   amtStr  - 金额（已格式化，如 "90.00"）
 *
 * 布局逻辑：
 *   [品名...(补空格到24)] [数量(补空格到6)] [单价(10位)] [金额(右对齐到40)]
 */
function buildProductLine(name, qtyStr, priceStr, amtStr) {
  var nameW = measureWidth(name);
  var qtyW  = measureWidth(qtyStr);

  var s = name;
  if (nameW < NAME_COL) s += repeatStr(' ', NAME_COL - nameW);  // 品名后补空格
  s += qtyStr;
  if (qtyW < QTY_COL) s += repeatStr(' ', QTY_COL - qtyW);     // 数量后补空格
  s += priceStr;
  // 金额列右对齐：计算单价列结束位置到金额起始位的间距
  var posAfterPrice = PRICE_START + priceStr.length;           // 单价是纯 ASCII 数字
  s += repeatStr(' ', AMT_START - posAfterPrice);
  s += amtStr;
  return s;
}

/**
 * 金额格式化为两位小数
 * 示例：fmtPrice(45) → "45.00"
 */
function fmtPrice(p) {
  return parseFloat(p).toFixed(2);
}


// ===================================================================
//  第四部分：人民币大写转换
// ===================================================================

/**
 * 将数字金额转为中文大写
 *
 * 示例：
 *   toChineseAmount(790.90) → "柒佰玖拾元玖角整"
 *   toChineseAmount(45.00)  → "肆拾伍元整"
 *
 * 规则：
 *   - 整数部分按位映射到"拾佰仟万"
 *   - 小数部分只处理角（.X0 → X角），不处理分
 *   - 末尾加"整"
 *
 * 注意：当前实现适用于万元以内金额，超过万元需扩展。
 */
function toChineseAmount(amount) {
  var digits = '零壹贰叁肆伍陆柒捌玖';       // 数字 → 大写映射
  var units  = ['', '拾', '佰', '仟', '万'];  // 数位单位
  var yuan   = Math.floor(amount);            // 整数部分（元）
  var jiao   = Math.round((amount - yuan) * 10);  // 小数部分（角）

  // 逐位转换整数部分
  var s = '';
  var yStr = '' + yuan;
  for (var i = 0; i < yStr.length; i++) {
    var d   = parseInt(yStr.charAt(i));       // 当前位数字
    var pos = yStr.length - i - 1;            // 从右往左的位置（0=个位）
    s += digits.charAt(d);                    // 数字 → 大写
    if (d !== 0) s += units[pos % 4];         // 非零时加单位（拾/佰/仟）
    if (pos === 4 && yStr.length > 4) s += '万';  // 万位标识
  }

  // 整理连续零和末尾零
  s = s.replace(/零+/g, '零');     // 多个连续零 → 一个"零"
  s = s.replace(/零$/, '');        // 去掉末尾的"零"
  s += '元';

  // 角
  if (jiao > 0) {
    s += digits.charAt(jiao) + '角';
  }
  s += '整';
  return s;
}


// ===================================================================
//  第五部分：核心打印流程
//  这是整个模块的入口函数，组装打印队列并逐条发送到打印机。
// ===================================================================

/**
 * 执行送货单打印
 *
 * @param {Object} ble  - 蓝牙通信对象
 *        ble.sendData(ArrayBuffer)  → 发送控制指令（原样二进制）
 *        ble.sendText(string)       → 发送文本（调用方需内部做 GBK 编码）
 *
 * @param {Object} opts - 送货单数据
 *        详细字段说明见文件顶部【使用方式】
 */
function print(ble, opts) {

  // ----- 解析参数 -----
  var data        = opts || {};
  var title       = data.title       || '送货单';           // 标题
  var orderNo     = data.orderNo     || '';                 // 单号
  var phones      = data.phones      || [];                 // 联系信息数组
  var customer    = data.customer    || '';                 // 收货单位
  var date        = data.date        || '';                 // 日期
  var products    = data.products    || [];                 // 商品列表
  var deliveryMan = data.deliveryMan || '';                 // 送货人
  var receiver    = data.receiver    || '________';         // 收货人（默认留空签字）

  // ----- 自动计算合计 -----
  var totalQty = 0, totalAmt = 0;
  for (var i = 0; i < products.length; i++) {
    totalQty += products[i].qty || 0;
    totalAmt += (products[i].qty || 0) * (products[i].price || 0);
  }

  // ===== 构建打印队列 =====
  // 队列中每项可以是：
  //   ArrayBuffer     → 通过 ble.sendData() 发送（ESC/POS 控制指令）
  //   { t: "文本" }   → 通过 ble.sendText() 发送
  //     .c = true      → 发送前先切换居中对齐，发送后恢复左对齐
  //     .b = true      → 发送前先开启加粗，发送后关闭加粗
  //   { s: true }     → 打印单分隔线 "------..."
  //   { d: true }     → 打印双分隔线 "=====..."

  var queue = [];

  // 第1块：标题区
  queue.push(init());                          // 1. 初始化打印机
  queue.push(alignCenter());                   // 2. 改为居中
  queue.push(doubleWH());                      // 3. 倍宽倍高
  queue.push(boldOn());                        // 4. 加粗
  queue.push({ t: title });                    // 5. 打印标题（如"东莞市维俊食品送货单"）
  queue.push(normalSize());                    // 6. 恢复正常大小
  queue.push(boldOff());                       // 7. 关闭加粗
  queue.push({ t: '' });                       // 8. 空行（拉开标题与单号间距）
  queue.push({ t: orderNo, c: true });         // 9. 打印单号（居中）
  queue.push(alignLeft());                     // 10. 恢复左对齐
  queue.push({ d: true });                     // 11. 双线分隔 ======

  // 第2块：联系信息
  for (var p = 0; p < phones.length; p++) {
    queue.push({ t: phones[p] });              // 逐行打印电话/微信/投诉
  }
  queue.push({ s: true });                     // 单线分隔 -----

  // 第3块：客户信息
  queue.push({ t: '收货单位: ' + customer });
  queue.push({ t: '日    期: ' + date });
  queue.push({ s: true });                     // 单线分隔 -----

  // 第4块：表头
  queue.push({ t: buildHeader(), b: true });   // 品名/数量/单价/金额（加粗）
  queue.push({ s: true });                     // 单线分隔 -----

  // 第5块：商品列表
  for (var r = 0; r < products.length; r++) {
    var prod = products[r];
    var qtyStr   = prod.qty + prod.unit;               // 数量+单位 → "2箱"
    var priceStr = fmtPrice(prod.price);               // 单价格式化 → "45.00"
    var amtStr   = fmtPrice(prod.qty * prod.price);   // 金额 = 数量 × 单价

    // 第一行：品名 + 数量 + 单价 + 金额（列对齐）
    queue.push({ t: buildProductLine(prod.name, qtyStr, priceStr, amtStr) });

    // 第二行：条码（如果提供了条码字段）
    if (prod.barcode) {
      queue.push({ t: prod.barcode });
    }
  }
  queue.push({ s: true });                     // 单线分隔 -----

  // 第6块：金额合计
  var totalLine = '合计: ' + totalQty + '件' +
                  repeatStr(' ', AMT_START - measureWidth('合计: ' + totalQty + '件') - 6) +
                  '金额: ' + totalAmt.toFixed(2) + '元';
  queue.push({ t: totalLine, b: true });       // 合计行（加粗）
  queue.push({ d: true });                     // 双线分隔 ======

  // 第7块：人民币大写
  var chineseAmt = toChineseAmount(totalAmt);
  queue.push({ t: '人民币(大写): ' + chineseAmt, b: true, c: true });  // 大写金额（居中加粗）
  queue.push({ d: true });                     // 双线分隔 ======

  // 第8块：签名区
  var sigLine = '送货人: ' + deliveryMan +
                repeatStr(' ', AMT_START - measureWidth('送货人: ' + deliveryMan) - 6) +
                '收货人: ' + receiver;
  queue.push({ t: sigLine });
  queue.push({ t: '签收日期: ____年____月____日' });

  // 第9块：尾部走纸（让用户方便撕纸）
  queue.push(feed(3));


  // ===== 逐条发送队列 =====
  // 说明：BLE 蓝牙打印机缓冲区有限，连续发送多条指令可能溢出丢数据。
  //       每条指令之间间隔 50ms，确保打印机有足够时间处理。
  //       第一条指令前额外等 30ms，让打印机从待机状态准备好。

  function delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function run(i) {
    // 队列全部发送完毕
    if (i >= queue.length) {
      wx.showToast({ title: '打印完成', icon: 'success' });
      return;
    }

    var item = queue[i];
    var wait = 50;  // 每条指令间等待 50ms（可根据实际情况调整 30~80ms）

    // 执行完当前项的后续动作
    var done = function() {
      delay(wait).then(function() { run(i + 1); });
    };

    // 根据队列项类型执行不同操作
    if (item instanceof ArrayBuffer) {
      // 类型 A：ESC/POS 控制指令 → sendData 发送二进制
      ble.sendData(item);
      done();

    } else if (item.t !== undefined) {
      // 类型 B：文本行
      //   先发送前置样式指令（居中/加粗）
      //   再发送文本内容
      //   最后发送后置恢复指令（关加粗/恢复左对齐）
      if (item.c) ble.sendData(alignCenter());   // c=true → 先居中
      if (item.b) ble.sendData(boldOn());         // b=true → 先加粗
      ble.sendText(item.t + '\r\n');              // 发送文本（\r\n 换行）
      if (item.b) ble.sendData(boldOff());        // b=true → 关加粗
      if (item.c) ble.sendData(alignLeft());      // c=true → 恢复左对齐
      done();

    } else if (item.s) {
      // 类型 C：单分隔线 "--------------------..."
      ble.sendText(repeatStr('-', TOTAL_COL) + '\r\n');
      done();

    } else if (item.d) {
      // 类型 D：双分隔线 "====================..."
      ble.sendText(repeatStr('=', TOTAL_COL) + '\r\n');
      done();

    } else {
      // 未知类型，直接跳过
      done();
    }
  }

  // 启动：先等 30ms 再开始发送第一条
  delay(30).then(function() { run(0); });
}

// ===================================================================
//  导出接口
// ===================================================================

module.exports = {
  // 主入口：执行送货单打印
  print: print,

  // 辅助函数（供外部调试或自定义排版使用）
  measureWidth: measureWidth,              // 字符串宽度测量（中文2/ASCII1）
  toChineseAmount: toChineseAmount,        // 数字→中文大写金额
};
