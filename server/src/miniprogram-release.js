import { zipSync, strToU8 } from 'fflate';
import { fail } from './lib.js';
import { serviceOrigin } from './payment-config.js';

export function miniProgramRelease(config) {
  const origin = serviceOrigin(config.publicBaseUrl);
  if (!/^wx[a-zA-Z0-9]{16}$/.test(config.appId || '') || !origin)
    fail(409, '请先保存小程序 AppID 和 HTTPS 服务域名');

  const files = {
    'config.js': `module.exports = {\n  apiBase: ${JSON.stringify(origin)},\n  devLogin: false,\n};\n`,
    'project.config.json': `${JSON.stringify(
      {
        description: '单店到店自取点餐小程序',
        miniprogramRoot: './',
        projectname: 'pickup-ordering',
        appid: config.appId,
        setting: { urlCheck: true, es6: true, enhance: true, postcss: true },
      },
      null,
      2,
    )}\n`,
    '使用说明.txt': `将 config.js 和 project.config.json 放入 miniprogram/ 目录，覆盖同名文件后在微信开发者工具上传正式版。\n请在微信公众平台将 ${origin} 分别配置为 request、uploadFile 和 downloadFile 合法域名，并确保域名已备案且 HTTPS 可访问。\n修改 AppID 或初始请求域名后需要重新上传小程序。后台保存的 AppSecret、商户资料和支付回调配置在服务器即时生效。\n`,
  };
  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])),
    ),
  );
}
