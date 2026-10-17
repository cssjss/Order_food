# 单店到店自取点餐小程序

项目包含原生微信小程序、Node.js API 和 PC 商家管理端。商家在管理端编辑菜品、分类、店铺信息及首页内容，小程序从同一套接口读取数据。仅支持到店自取。

项目当前进度、线上发布记录和下次对话注意事项见 [项目交接.md](项目交接.md)。

## 项目结构

| 目录           | 用途                                 |
| -------------- | ------------------------------------ |
| `miniprogram/` | 微信原生小程序源码                   |
| `admin/`       | React 商家管理端                     |
| `server/`      | Node.js API、SQLite 数据库和支付接口 |
| `data/`        | SQLite 数据文件，需持久化和备份      |
| `uploads/`     | 菜品图、横幅和头像，需持久化和备份   |

## 本地运行

需要 **Node.js 24 或更高版本**，无需单独安装数据库。本文件夹已安装依赖，并生成仅供本地使用的 `.env`。管理员账号与随机密码在 `.env` 中；不要将该文件提交到仓库。

```bash
npm run dev
```

- 管理端：`http://localhost:5173/admin/`
- API：`http://localhost:3000/api/health`
- 本地 `.env` 已开启模拟支付，可以验证订单和出餐流程；不会产生真实交易。

单独构建和启动：

```bash
npm run build
npm start
```

此时管理端位于 `http://localhost:3000/admin/`。首次启动自动创建示例分类和菜品，可在后台修改。

## 打开微信小程序

1. 使用微信开发者工具导入 `miniprogram/`。
2. 如需切回本地调试，可将 [`config.js`](miniprogram/config.js) 设为 `apiBase: 'http://localhost:3000'`、`devLogin: true`，并在开发者工具中关闭“校验合法域名”。正式上传时须恢复发布配置。
3. 正式发布前在管理端“**小程序与支付**”填写小程序 AppID、AppSecret 和 HTTPS 服务域名，保存后下载“发布配置包”。将其中的 `config.js` 和 `project.config.json` 覆盖到 `miniprogram/`，再用微信开发者工具上传。
4. 在微信公众平台“开发管理 → 开发设置 → 服务器域名”中，把同一个 HTTPS 域名分别登记为 **request、uploadFile、downloadFile 合法域名**。本项目使用 `wx.uploadFile` 上传头像。确保域名已备案、HTTPS 可公网访问；小程序的初始请求域名和 AppID 在发布包内，更改它们必须重新上传小程序。

微信现在要求用户主动选择头像、昵称。小程序使用 `wx.login` 建立账号，并在个人中心提供头像选择和昵称输入；无法在用户未操作时静默读取头像昵称。

## 商家管理功能

- **工作台**：今日营业额、订单数、待接单和制作中订单。
- **订单管理**：15 秒自动刷新；接单 → 制作完成 → 订单完结；按状态、日期筛选和导出 `.xlsx`；手动重发打印小票。
- **顾客管理**：按昵称或订单号搜索小程序顾客，查看资料、消费统计和最近订单；可记录内部备注，或填写原因后停用及恢复账号。有未处理订单时不能停用，操作会写入记录。
- **余额管理**：顾客在小程序个人中心使用微信支付充值，可在结算时选择余额支付；充值、支付、退款和商家调整都有余额流水。管理端顾客详情可填写金额与原因，增加或扣减余额；扣减不能超过当前余额。商家增加的余额可立即用于订单支付，并单独记录为“商家增加”，不会记为微信充值。余额支付订单拒单后会自动退回余额。
- **菜品与分类**：菜品图片、价格、库存、多组规格及加价、上架状态、首页推荐、分类启停和排序、批量上下架。
- **页面配置**：店铺名称、营业时间、公告、电话、取餐地址与提示；首页横幅、主题色、标题、推荐区和个人中心寄语，并提供首页预览。
- **销售报表**：最近 30 天每日营业额与菜品销量排行。
- **小程序与支付**：管理员分阶段录入小程序登录、HTTPS 服务域名和微信支付商户资料，并下载小程序发布配置包；密钥使用 `CONFIG_ENCRYPTION_KEY` 加密保存，后台不返回原文。
- **操作记录**：记录主要管理操作、订单状态变更和打印失败。

小程序底部导航为“首页、点餐、购物车、我的”：首页展示店铺信息与推荐菜品，点餐页提供搜索、分类和全部菜品；订单列表从个人中心进入，状态快捷入口可直接打开对应分类。

顾客可搜索并保留本地搜索历史，按规格加入购物车、选择商品结算，查看订单状态、收藏菜品、联系商家及再次下单。购物车保存在小程序本地。待付款订单 15 分钟后自动尝试关单并恢复库存。

小程序视觉参考了目录中的 `model.png` 的浅绿配色和左侧分类列表。该图中的扫码桌点餐和预约入口与本项目“仅到店自取”的需求不符，因此没有加入。

## 真实微信支付

本地模拟支付由 `MOCK_PAYMENT=true` 控制，**生产环境不会启用模拟支付**。真实支付前需要：

1. 已开通 JSAPI 支付的小程序和微信支付商户号。
2. 对外可访问的 HTTPS 域名，并将请求域名配置到微信小程序后台。
3. 在管理端“小程序与支付”填写 AppID、AppSecret、HTTPS 服务域名、商户号、商户证书序列号、商户私钥 PEM、微信支付平台证书 PEM 和 API v3 密钥。系统使用该服务域名的 `/api/pay/notify` 接收支付通知。
4. 确保服务器 `.env` 的 `CONFIG_ENCRYPTION_KEY` 是固定的 64 位十六进制随机值。丢失后已保存的支付密钥无法解密。
5. 用真实小程序和商户账号完成一笔小额验证订单，确认支付通知抵达 `/api/pay/notify`，后台收到待接单订单。

也可通过 [`.env.example`](.env.example) 中的 `WECHAT_*` 环境变量配置；管理端保存的配置优先。微信支付响应和通知都进行平台证书签名验证。平台证书轮换后需及时更新证书和序列号。

微信支付订单拒单后会进入“待退款”。管理员需在**微信商户平台手动办理整单退款**，再在订单详情登记退款凭证；系统不会自动调用退款接口。余额支付订单拒单时系统会立即退回顾客余额并记录流水。充值到账以微信支付通知或服务端查询确认结果为准，前端支付成功回调不会直接增加余额。

## 云打印机

设置 `PRINTER_WEBHOOK_URL` 和 `PRINTER_WEBHOOK_TOKEN` 后，新付款订单会向该地址发送 JSON 小票数据：

```json
{
  "orderNo": "订单号",
  "paidAt": "付款时间",
  "remark": "订单备注",
  "amount": 2680,
  "items": [
    { "name": "招牌照烧鸡饭", "options_label": "份量：标准份", "unit_price": 2680, "quantity": 1 }
  ]
}
```

金额单位是**分**；请求带 `Authorization: Bearer <PRINTER_WEBHOOK_TOKEN>`。不同云打印机厂商的 API 不同，请将其厂商接口接到这个 webhook 适配服务。发送失败会记录在“操作记录”，可在订单详情重新发送。

## 服务器部署

### 当前服务器（`order.testclf01.xyz`）

当前点餐系统部署在与 ERP 共用的服务器上：宝塔 Nginx 将 `https://order.testclf01.xyz` 转发至仅监听 `127.0.0.1:3000` 的 `order-food.service`；ERP 的 `www.testclf01.xyz` 继续使用自己的站点和 3001 端口。Admin 构建产物由同一 Node 服务提供，更新时须同时发布 `admin/dist` 和 `server/src`。

- 程序版本：`/opt/order-food/releases/`；`/opt/order-food/current` 指向当前版本。
- 持久化数据与生产配置：`/opt/order-food/shared/data`、`uploads`、`.env`。升级时不要覆盖或删除。
- 服务检查：`systemctl status order-food.service`、`curl http://127.0.0.1:3000/api/health`。
- Nginx 配置：`/www/server/panel/vhost/nginx/order.testclf01.xyz.conf`。证书由 Certbot 签发，`certbot-renew.timer` 自动续期并在续期后重载 Nginx。
- 小程序微信登录还需要在微信公众平台的“开发管理 → 开发设置 → 服务器域名/接口 IP 白名单”中，把服务器出口 IP `47.104.141.32` 加入接口 IP 白名单。此项与 request/uploadFile/downloadFile 合法域名是两项不同的配置；未加入时微信 `jscode2session` 会返回 `40164`。
- 每次发布先运行 `npm test && npm run build`，将 `server/src`、`admin/dist`、工作区包文件和锁文件打包到新的版本目录，执行 `npm ci --omit=dev`，连接共享数据目录，再切换 `current` 并重启服务。发布后检查点餐后台、API 和 ERP 首页；失败时将 `current` 切回上一个版本并重启服务。

首次部署沿用了本地 `.env` 中的管理员账号、密码和加密密钥，生产服务器另设 `NODE_ENV=production`、`MOCK_PAYMENT=false`、`HOST=127.0.0.1`、`TRUST_PROXY=true`。不要把 `.env` 或 `ssh.txt` 放进发布包。

### 其他服务器

推荐使用 Docker Compose，并用 Nginx 或其他网关提供 HTTPS：

```bash
cp .env.example .env
# 编辑 .env：设置 ADMIN_USERNAME、强随机 ADMIN_PASSWORD、SESSION_SECRET、CONFIG_ENCRYPTION_KEY
docker compose up -d --build
```

[`compose.yaml`](compose.yaml) 将服务绑定在服务器的 `127.0.0.1:3000`。将域名的 HTTPS 请求反向代理到该端口；证书与域名配置应在微信小程序后台完成。管理端入口为 `https://你的域名/admin/`。非 Docker 环境也可运行 `npm ci && npm run build && npm start`。

反向代理需允许至少 6 MB 的请求体，以便上传最大 5 MB 的图片（Nginx 可设置 `client_max_body_size 6m;`）。

发布前将 `.env` 的 `NODE_ENV` 设为 `production`、`MOCK_PAYMENT` 设为 `false`。Docker Compose 已覆盖这两个变量。若反向代理需要从请求 IP 识别管理员登录限流，可将 `TRUST_PROXY=true`，并只允许可信代理访问 Node 服务。

请备份 `data/`、`uploads/` 和 `.env` 中的加密密钥。迁移服务器时三者须一同迁移。不要公开 `.env`、SQLite 数据库或商户私钥。数据库使用 SQLite WAL，适合需求中的单店规模。

## 验证

```bash
npm test
npm run build
npm audit --omit=dev
```

自动化测试覆盖规格计价、并发库存扣减、模拟支付、后台出餐状态、超时关单、库存恢复、访问控制、页面设置同步、密钥加密、小程序发布配置导出与 Excel 导出。真实微信支付和云打印需要对应商户凭据及设备才能做端到端验收。
