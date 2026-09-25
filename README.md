# 猫咪小院 · 像素流浪猫物语

手机优先的像素猫咪布置游戏：15 种道具、8 种猫咪、3 张大地图、任务金币、触屏拖动和双指缩放。单机无需安装依赖，进度保存在本机浏览器。

## 本地游玩

主页 `index.html` 依赖同目录的 `style.css`、`game.js` 和 `online.js`。在文件模式下部分浏览器会限制 ES Module；建议通过静态 HTTP 服务器或 GitHub Pages 打开。

## 好友联机配置

联机部分基于 Firebase Authentication 匿名登录与 Realtime Database。首次使用需要在 Firebase 控制台创建 Web App、启用匿名登录和 Realtime Database，将 Web 配置填入 `firebase-config.js`，并把 `database.rules.json` 的规则部署到数据库。网页配置中的 API key 是客户端标识，不要把 Service Account 私钥放进网页仓库；数据库权限由安全规则保护。

配置留空时，单机功能仍可玩，联机按钮会说明尚未配置。当前公开站点尚未绑定 Firebase 项目，因此好友房间不会实际连接，需完成上述配置后才可启用。

## 发布到 GitHub Pages

将 `index.html`、`style.css`、`game.js`、`online.js`、`firebase-config.js`、`database.rules.json` 和 `.nojekyll` 放到仓库根目录；之后在 **Settings → Pages** 选择 `main` 分支和 `/(root)`。
