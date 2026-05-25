/**
 * ============================================================
 *  80mm 热敏纸 — 送货单打印模板（独立版）
 *  v1.0  2026-05-25
 * ============================================================
 *
 * 【重要说明】
 *   本文件完全独立，不依赖项目的任何其他代码。
 *   使用 IZM 蓝牙打印机原厂 API 直接发送：
 *     writeBLEBuffer(ArrayBuffer)      — 发送 ESC/POS 控制指令
 *     writeBLECharacteristicValue(str) — 发送文本（内部已含 GBK 编码）
 *
 * 【使用方法】
 *   1. 将本文件复制到你的微信小程序项目的 utils/ 目录
 *   2. 在你的页面中引入：
 *        const delivery = require('./utils/送货单打印模板_独立版.js');
 *   3. 连接蓝牙后，调用打印：
 *        delivery.print({
 *          title: '东莞市维俊食品送货单',
 *          orderNo: 'NO.2600795',
 *          phones: [...],
 *          customer: '...',
 *          date: '...',
 *          products: [...],
 *          deliveryMan: '...',
 *        });
 */

// ===================================================================
//  第一部分：ESC/POS 指令函数
//  每个函数返回 ArrayBuffer，由 writeBLEBuffer() 发送
// ===================================================================

/**
 * 将多个字节值组装成 ArrayBuffer
 * 用法：ESC(0x1B, 0x40) → 返回打印机初始化指令
 */
function ESC() {
  var buf = new ArrayBuffer(arguments.length);
  var view = new DataView(buf);
  for (var i = 0; i < arguments.length; i++) {
    view.setUint8(i, arguments[i]);
  }
  return buf;
}

// --- 打印机控制 ---
function cmdInit()       { return ESC(0x1B, 0x40); }        // ESC @  初始化
function cmdFeed(n)      { return ESC(0x1B, 0x64, n || 4); } // ESC d  走纸 n 行

// --- 对齐方式 ---
function cmdAlignLeft()  { return ESC(0x1B, 0x61, 0x00); }  // 左对齐
function cmdAlignCenter(){ return ESC(0x1B, 0x61, 0x01); }  // 居中对齐

// --- 加粗 ---
function cmdBoldOn()     { return ESC(0x1B, 0x45, 0x01); }  // 加粗开
function cmdBoldOff()    { return ESC(0x1B, 0x45, 0x00); }  // 加粗关

// --- 字体大小 ---
// GS ! n : 低4位=纵向倍数, 高4位=横向倍数
function cmdNormalSize() { return ESC(0x1D, 0x21, 0x00); }  // 正常大小
function cmdDoubleWH()   { return ESC(0x1D, 0x21, 0x11); }  // 倍宽+倍高（标题）

// ===================================================================
//  第二部分：排版参数（80mm 纸宽）
//  修改这些数值可调整列宽和间距
// ===================================================================

var PAPER_WIDTH = 48;    // 每行总字符位（80mm纸 = 48个ASCII字符）
var COL_NAME    = 24;    // 品名列宽度（24个字符位 = 12个中文）
var COL_QTY     = 6;     // 数量列宽度
var COL_PRICE   = 10;    // 单价列宽度
var POS_QTY     = COL_NAME;               // 数量列起始位 = 24
var POS_PRICE   = POS_QTY + COL_QTY;      // 单价列起始位 = 30
var POS_AMT     = POS_PRICE + COL_PRICE;  // 金额列起始位 = 40

// ===================================================================
//  第三部分：排版辅助函数
// ===================================================================

/** 重复字符 n 次 */
function repeat(ch, n) {
  return new Array(n + 1).join(ch);
}

/** 混合字符串宽度：中文=2, ASCII=1 */
function strWidth(str) {
  var w = 0;
  for (var i = 0; i < str.length; i++) {
    w += (str.charCodeAt(i) > 127) ? 2 : 1;
  }
  return w;
}

/** 构建表头行 */
function buildHeader() {
  var s = '品名';
  s += repeat(' ', COL_NAME - 4);                        // 4宽 → 24位
  s += '数量';
  s += repeat(' ', POS_PRICE - (COL_NAME + 4));          // 4宽 → 30位
  s += '单价';
  s += repeat(' ', POS_AMT - (POS_PRICE + 4));           // 4宽 → 40位
  s += '金额';
  return s;
}

/** 构建产品行 */
function buildProductLine(name, qtyStr, priceStr, amtStr) {
  var nw = strWidth(name);
  var qw = strWidth(qtyStr);

  var s = name;
  if (nw < COL_NAME) s += repeat(' ', COL_NAME - nw);
  s += qtyStr;
  if (qw < COL_QTY)  s += repeat(' ', COL_QTY - qw);
  s += priceStr;
  var afterPrice = POS_PRICE + priceStr.length;
  s += repeat(' ', POS_AMT - afterPrice);
  s += amtStr;
  return s;
}

/** 金额 → 两位小数 */
function fmtPrice(p) {
  return parseFloat(p).toFixed(2);
}

/** 金额 → 中文大写 */
function toChinese(amount) {
  var D = '零壹贰叁肆伍陆柒捌玖';
  var U = ['', '拾', '佰', '仟', '万'];
  var yuan = Math.floor(amount);
  var jiao = Math.round((amount - yuan) * 10);

  var s = '';
  var y  = '' + yuan;
  for (var i = 0; i < y.length; i++) {
    var d = parseInt(y.charAt(i));
    var p = y.length - i - 1;
    s += D.charAt(d);
    if (d !== 0) s += U[p % 4];
    if (p === 4 && y.length > 4) s += '万';
  }
  s = s.replace(/零+/g, '零').replace(/零$/, '');
  s += '元';
  if (jiao > 0) s += D.charAt(jiao) + '角';
  s += '整';
  return s;
}


// ===================================================================
//  第四部分：主打印函数（对方直接调用这个）
// ===================================================================

/**
 * 打印送货单
 *
 * @param {Object} data - 送货单数据
 *   data.title       - 标题（如"东莞市维俊食品送货单"）
 *   data.orderNo     - 单号（如"NO.2600795"）
 *   data.phones      - 联系信息数组，每项一行
 *   data.customer    - 收货单位
 *   data.date        - 日期
 *   data.products    - 商品数组：[{ barcode, name, qty, unit, price }]
 *   data.deliveryMan - 送货人
 *   data.receiver    - 收货人（不传则打印"________"供签字）
 */
function print(data) {
  data = data || {};

  // 解析字段
  var title       = data.title       || '送货单';
  var orderNo     = data.orderNo     || '';
  var phones      = data.phones      || [];
  var customer    = data.customer    || '';
  var date        = data.date        || '';
  var products    = data.products    || [];
  var deliveryMan = data.deliveryMan || '';
  var receiver    = data.receiver    || '________';

  // 自动计算合计
  var totalQty = 0, totalAmt = 0;
  for (var i = 0; i < products.length; i++) {
    totalQty += products[i].qty || 0;
    totalAmt += (products[i].qty || 0) * (products[i].price || 0);
  }

  // ---- 第1块：标题区 ----
  writeBLEBuffer(cmdInit());                        // 初始化打印机
  writeBLEBuffer(cmdAlignCenter());                 // 居中
  writeBLEBuffer(cmdDoubleWH());                    // 倍宽倍高
  writeBLEBuffer(cmdBoldOn());                      // 加粗
  writeBLECharacteristicValue(title + '\r\n');       // 标题
  writeBLEBuffer(cmdNormalSize());                  // 恢复正常
  writeBLEBuffer(cmdBoldOff());                     // 关加粗
  writeBLECharacteristicValue('\r\n');               // 空行（拉开间距）
  writeBLECharacteristicValue(orderNo + '\r\n');     // 单号
  writeBLEBuffer(cmdAlignLeft());                   // 恢复左对齐
  writeBLECharacteristicValue(repeat('=', PAPER_WIDTH) + '\r\n');  // ======

  // ---- 第2块：联系信息 ----
  for (var p = 0; p < phones.length; p++) {
    writeBLECharacteristicValue(phones[p] + '\r\n');
  }
  writeBLECharacteristicValue(repeat('-', PAPER_WIDTH) + '\r\n');  // -----

  // ---- 第3块：客户信息 ----
  writeBLECharacteristicValue('收货单位: ' + customer + '\r\n');
  writeBLECharacteristicValue('日    期: ' + date + '\r\n');
  writeBLECharacteristicValue(repeat('-', PAPER_WIDTH) + '\r\n');

  // ---- 第4块：表头 ----
  writeBLEBuffer(cmdBoldOn());
  writeBLECharacteristicValue(buildHeader() + '\r\n');
  writeBLEBuffer(cmdBoldOff());
  writeBLECharacteristicValue(repeat('-', PAPER_WIDTH) + '\r\n');

  // ---- 第5块：商品列表 ----
  for (var r = 0; r < products.length; r++) {
    var prod     = products[r];
    var qtyStr   = prod.qty + prod.unit;
    var priceStr = fmtPrice(prod.price);
    var amtStr   = fmtPrice(prod.qty * prod.price);

    // 第一行：品名 + 数量 + 单价 + 金额
    writeBLECharacteristicValue(buildProductLine(prod.name, qtyStr, priceStr, amtStr) + '\r\n');

    // 第二行：条码
    if (prod.barcode) {
      writeBLECharacteristicValue(prod.barcode + '\r\n');
    }
  }
  writeBLECharacteristicValue(repeat('-', PAPER_WIDTH) + '\r\n');

  // ---- 第6块：合计 ----
  writeBLEBuffer(cmdBoldOn());
  var totalLine = '合计: ' + totalQty + '件' +
    repeat(' ', POS_AMT - strWidth('合计: ' + totalQty + '件') - 6) +
    '金额: ' + totalAmt.toFixed(2) + '元';
  writeBLECharacteristicValue(totalLine + '\r\n');
  writeBLEBuffer(cmdBoldOff());
  writeBLECharacteristicValue(repeat('=', PAPER_WIDTH) + '\r\n');

  // ---- 第7块：人民币大写 ----
  writeBLEBuffer(cmdAlignCenter());
  writeBLEBuffer(cmdBoldOn());
  writeBLECharacteristicValue('人民币(大写): ' + toChinese(totalAmt) + '\r\n');
  writeBLEBuffer(cmdBoldOff());
  writeBLEBuffer(cmdAlignLeft());
  writeBLECharacteristicValue(repeat('=', PAPER_WIDTH) + '\r\n');

  // ---- 第8块：签名区 ----
  var sigLine = '送货人: ' + deliveryMan +
    repeat(' ', POS_AMT - strWidth('送货人: ' + deliveryMan) - 6) +
    '收货人: ' + receiver;
  writeBLECharacteristicValue(sigLine + '\r\n');
  writeBLECharacteristicValue('签收日期: ____年____月____日' + '\r\n');

  // ---- 第9块：走纸撕纸 ----
  writeBLEBuffer(cmdFeed(3));

  wx.showToast({ title: '打印完成', icon: 'success' });
}

// ===================================================================
//  导出
// ===================================================================

module.exports = {
  print: print,
  // 辅助函数也导出，供对方自定义排版
  strWidth: strWidth,
  toChinese: toChinese,
  buildHeader: buildHeader,
  buildProductLine: buildProductLine
};
