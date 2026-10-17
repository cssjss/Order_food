import { zipSync, strToU8 } from 'fflate';

const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
const cell = (column, row, value, numeric = false) =>
  numeric
    ? `<c r="${column}${row}"><v>${Number(value) || 0}</v></c>`
    : `<c r="${column}${row}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
const status = {
  PENDING_PAYMENT: '待付款',
  PENDING_ACCEPTANCE: '待接单',
  PREPARING: '制作中',
  READY: '待取餐',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REFUND_PENDING: '待退款',
  REFUNDED: '已退款',
};

export function orderWorkbook(rows) {
  const headers = ['订单号', '下单时间', '状态', '菜品', '金额（元）', '备注'];
  const records = [
    headers,
    ...rows.map((row) => [
      row.order_no,
      new Date(row.created_at).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      }),
      status[row.status] || row.status,
      row.items,
      row.amount / 100,
      row.remark,
    ]),
  ];
  const sheetRows = records
    .map(
      (record, index) =>
        `<row r="${index + 1}">${record.map((value, column) => cell('ABCDEF'[column], index + 1, value, index > 0 && column === 4)).join('')}</row>`,
    )
    .join('');
  const files = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="订单" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="25" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="18" customWidth="1"/><col min="4" max="4" width="60" customWidth="1"/><col min="5" max="5" width="16" customWidth="1"/><col min="6" max="6" width="40" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])),
    ),
  );
}
