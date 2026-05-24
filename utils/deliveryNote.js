/**
 * ========================================
 *  80mm 热敏纸 — 送货单打印模板
 *  v1.0  独立模块 · 可直接引入任何微信小程序
 * ========================================
 *
 * === 使用方式 ===
 *
 *   const deliveryNote = require('./utils/deliveryNote.js');
 *
 *   // 连接蓝牙后调用
 *   deliveryNote.print(bluetooth, {
 *     title: '东莞市维俊食品送货单',
 *     orderNo: 'NO.2600795',
 *     phones: ['订货电话: 18122884991  18122914891', '微 信: W18122914891', '投诉电话: 13694950666'],
 *     customer: '永辉超市(长安店)',
 *     date: '2026年5月22日',
 *     products: [
 *       { barcode: '6970618570049', name: '蒙牛纯牛奶 946ml',       qty: 2,  unit: '箱', price: 45.00 },
 *       { barcode: '6970713990711', name: '白胡椒粉 2500g',         qty: 1,  unit: '袋', price: 68.00 },
 *     ],
 *     deliveryMan: '李伟',
 *     receiver: '张明',
 *   });
 *
 * === bluetooth 对象需提供 ===
 *   bluetooth.sendData(ArrayBuffer)  — 发送 ESC/POS 指令
 *   bluetooth.sendText(string)       — 发送文本（内部 GBK 编码）
 */

var GBK;

// ==================== ESC/POS 指令构建 ====================

function makeESC() {
  var buf = new ArrayBuffer(arguments.length);
  var view = new DataView(buf);
  for (var i = 0; i < arguments.length; i++) view.setUint8(i, arguments[i]);
  return buf;
}

function init()       { return makeESC(0x1B, 0x40); }
function feed(n)      { return makeESC(0x1B, 0x64, Math.min(n || 4, 255)); }
function alignLeft()  { return makeESC(0x1B, 0x61, 0x00); }
function alignCenter(){ return makeESC(0x1B, 0x61, 0x01); }
function alignRight() { return makeESC(0x1B, 0x61, 0x02); }
function boldOn()     { return makeESC(0x1B, 0x45, 0x01); }
function boldOff()    { return makeESC(0x1B, 0x45, 0x00); }
function normalSize() { return makeESC(0x1D, 0x21, 0x00); }
function doubleWH()   { return makeESC(0x1D, 0x21, 0x11); }  // 倍宽倍高
function doubleW()    { return makeESC(0x1D, 0x21, 0x10); }  // 倍宽
function doubleH()    { return makeESC(0x1D, 0x21, 0x01); }  // 倍高

// ==================== 排版常量（80mm 纸宽） ====================

var TOTAL_COL  = 48;   // 80mm 纸标准ASCII字符数/行
var NAME_COL   = 24;   // 品名列宽（含条码区）
var QTY_COL    = 6;    // 数量列宽
var PRICE_COL  = 10;   // 单价列宽
var QTY_START  = NAME_COL;           // 数量起始位 = 24
var PRICE_START = QTY_START + QTY_COL; // 单价起始位 = 30
var AMT_START   = PRICE_START + PRICE_COL; // 金额起始位 = 40

// ==================== 内部辅助函数 ====================

function repeatStr(ch, n) {
  return new Array(n + 1).join(ch);
}

/** 构建表头行：品名 / 数量 / 单价 / 金额 对齐 */
function buildHeader() {
  var s = '品名';
  s += repeatStr(' ', NAME_COL - 4);     // 品名(4宽) → 数量起始位(24)
  s += '数量';
  s += repeatStr(' ', PRICE_START - (NAME_COL + 4)); // 数量(4) → 单价起始位(30)
  s += '单价';
  s += repeatStr(' ', AMT_START - (PRICE_START + 4)); // 单价(4) → 金额起始位(40)
  s += '金额';
  return s;
}

/** 构建单行产品：品名 + 数量 + 单价 + 金额（列对齐） */
function buildProductLine(name, qtyStr, priceStr, amtStr) {
  var nameW = measureWidth(name);
  var qtyW  = measureWidth(qtyStr);

  var s = name;
  if (nameW < NAME_COL) s += repeatStr(' ', NAME_COL - nameW);
  s += qtyStr;
  if (qtyW < QTY_COL) s += repeatStr(' ', QTY_COL - qtyW);
  s += priceStr;
  // 金额右对齐到 AMT_START
  var posAfterPrice = PRICE_START + priceStr.length; // priceStr 纯 ASCII
  s += repeatStr(' ', AMT_START - posAfterPrice);
  s += amtStr;
  return s;
}

/** 混合字符串宽度：中文=2, ASCII=1 */
function measureWidth(str) {
  var w = 0;
  for (var i = 0; i < str.length; i++) {
    w += (str.charCodeAt(i) > 127) ? 2 : 1;
  }
  return w;
}

/** 数字金额转中文大写 */
function toChineseAmount(amount) {
  var digits = '零壹贰叁肆伍陆柒捌玖';
  var units = ['', '拾', '佰', '仟', '万'];
  var yuan = Math.floor(amount);
  var jiao = Math.round((amount - yuan) * 10);

  var s = '';
  var yStr = '' + yuan;
  for (var i = 0; i < yStr.length; i++) {
    var d = parseInt(yStr.charAt(i));
    var pos = yStr.length - i - 1;
    yStr.charAt(i);
    s += digits.charAt(d);
    if (d !== 0) s += units[pos % 4];
    if (pos === 4 && yStr.length > 4) s += '万';
  }
  // 简化：直接映射常用金额
  s = s.replace(/零+/g, '零').replace(/零$/, '');
  s += '元';
  if (jiao > 0) {
    s += digits.charAt(jiao) + '角';
  }
  s += '整';
  return s;
}

// ==================== 核心打印流程 ====================

function padTo(num, len) {
  var s = '' + num;
  while (s.length < len) s = ' ' + s;
  return s;
}

function fmtPrice(p) {
  return parseFloat(p).toFixed(2);
}

/**
 * 执行打印
 * @param {Object} ble  - 蓝牙通信对象 { sendData: fn, sendText: fn }
 * @param {Object} opts - 送货单数据（见文件头注释）
 */
function print(ble, opts) {
  // 初始化 GBK（延迟加载）
  if (!GBK) {
    try { GBK = require('./gbk.min.js'); } catch(e) {}
  }

  var data = opts || {};
  var title       = data.title       || '送货单';
  var orderNo     = data.orderNo     || '';
  var phones      = data.phones      || [];
  var customer    = data.customer    || '';
  var date        = data.date        || '';
  var products    = data.products    || [];
  var deliveryMan = data.deliveryMan || '';
  var receiver    = data.receiver    || '';

  // 计算汇总
  var totalQty = 0, totalAmt = 0;
  for (var i = 0; i < products.length; i++) {
    totalQty += products[i].qty || 0;
    totalAmt += (products[i].qty || 0) * (products[i].price || 0);
  }

  function L(t) { ble.sendText(t + '\r\n'); }           // 普通左对齐
  function C(t) { ble.sendData(alignCenter()); ble.sendText(t + '\r\n'); ble.sendData(alignLeft()); } // 居中文本
  function B(t) { ble.sendData(boldOn()); ble.sendText(t + '\r\n'); ble.sendData(boldOff()); } // 加粗
  function CB(t){ ble.sendData(alignCenter()); ble.sendData(boldOn()); ble.sendText(t + '\r\n'); ble.sendData(boldOff()); ble.sendData(alignLeft()); }
  function S()  { ble.sendText(repeatStr('-', TOTAL_COL) + '\r\n'); }  // 单线分隔
  function D()  { ble.sendText(repeatStr('=', TOTAL_COL) + '\r\n'); }  // 双线分隔

  // ---- 构建打印队列 ----
  var queue = [];

  queue.push(init());
  queue.push(alignCenter());
  queue.push(doubleWH());
  queue.push(boldOn());
  queue.push({ t: title });
  queue.push(normalSize());
  queue.push(boldOff());
  queue.push({ t: orderNo, c: true });
  queue.push(alignLeft());
  queue.push({ d: true });  // ======

  // 联系信息
  for (var p = 0; p < phones.length; p++) {
    queue.push({ t: phones[p] });
  }
  queue.push({ s: true });  // -----

  // 客户信息
  queue.push({ t: '收货单位: ' + customer });
  queue.push({ t: '日    期: ' + date });
  queue.push({ s: true });

  // 表头
  queue.push({ t: buildHeader(), b: true });
  queue.push({ s: true });

  // 产品列表
  for (var r = 0; r < products.length; r++) {
    var prod = products[r];
    var qtyStr  = prod.qty + prod.unit;
    var priceStr = fmtPrice(prod.price);
    var amtStr   = fmtPrice(prod.qty * prod.price);

    queue.push({ t: buildProductLine(prod.name, qtyStr, priceStr, amtStr) });
    if (prod.barcode) {
      queue.push({ t: prod.barcode });
    }
  }
  queue.push({ s: true });

  // 合计
  var totalLine = '合计: ' + totalQty + '件' +
                  repeatStr(' ', AMT_START - measureWidth('合计: ' + totalQty + '件') - 6) +
                  '金额: ' + totalAmt.toFixed(2) + '元';
  queue.push({ t: totalLine, b: true });
  queue.push({ d: true });

  // 大写
  var chineseAmt = toChineseAmount(totalAmt);
  queue.push({ t: '人民币(大写): ' + chineseAmt, b: true, c: true });
  queue.push({ d: true });

  // 签名
  var sigLine = '送货人: ' + deliveryMan +
                repeatStr(' ', AMT_START - measureWidth('送货人: ' + deliveryMan) - 4) +
                '收货人: ' + receiver;
  queue.push({ t: sigLine });
  queue.push({ t: '签收日期: ____年____月____日' });

  // 走纸
  queue.push(feed(3));

  // ---- 逐条发送（含延迟防 BLE 缓冲区溢出） ----
  function delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function run(i) {
    if (i >= queue.length) {
      wx.showToast({ title: '打印完成', icon: 'success' });
      return;
    }
    var item = queue[i];
    var wait = 50;  // 每条指令间隔 50ms

    var done = function() {
      delay(wait).then(function() { run(i + 1); });
    };

    if (item instanceof ArrayBuffer) {
      ble.sendData(item);
      done();
    } else if (item.t) {
      // 文本项
      if (item.c) ble.sendData(alignCenter());
      if (item.b) ble.sendData(boldOn());
      ble.sendText(item.t + '\r\n');
      if (item.b) ble.sendData(boldOff());
      if (item.c) ble.sendData(alignLeft());
      done();
    } else if (item.s) {
      ble.sendText(repeatStr('-', TOTAL_COL) + '\r\n');
      done();
    } else if (item.d) {
      ble.sendText(repeatStr('=', TOTAL_COL) + '\r\n');
      done();
    } else {
      done();
    }
  }
  delay(30).then(function() { run(0); });
}

module.exports = { print: print, measureWidth: measureWidth, toChineseAmount: toChineseAmount };
