# Genius Mind HQ – Trial Class 预约系统

独立于 Puchong Jaya 的一套：自己的 Google Sheet、自己的 Apps Script、自己的 GitHub 仓库。
家长资料只存在 Google Sheet；老师密码只放在 Apps Script 的“脚本属性”。这个仓库里没有任何个人资料或密码。

## 文件
- 根目录：放上 GitHub Pages 的网页
  - `index.html` 家长预约（手机号 → 资料 → 日期时段 → 确认；可改期；中英文）
  - `spin.html` Spin & Win 网上转盘（每个预约一次，奖品和机率由后台决定）
  - `teachers.html` 老师菜单
  - `calendar.html` 预约日历（家长电话、出席、代订、改期、取消、领奖、打印）
  - `availability.html` 开放日期（未来约 6 个月，每个时段 0–5 位家长，可复制整周）
  - `settings.html` 设置（改期次数、改期锁定时数、截止时数、通知邮箱、转盘开关）
  - `config.js` HQ 名称、地址、电话、WhatsApp、后台网址（公开资料）
- `apps-script/Code.gs` 后台，贴进新 Google Sheet 的 Apps Script
- `test/` 本地模拟测试（node + playwright），不用上传

## 第一次安装（Joseph 自己做，大约 15 分钟）
1. 在 Google Drive 新建一个空白 Google Sheet，命名例如 “GMA HQ Trial Class Bookings”。
2. 打开 扩展程序 → Apps Script，把 `Code.gs` 的内容全部贴进去，保存。
3. 在编辑器上方选 `setup` → 运行，第一次会要求授权，按允许。Sheet 会自动建好所有标签。
4. 左边 ⚙ 项目设置 → 脚本属性 → 新增：
   - `STAFF_PIN` = 老师密码（自己设，不要发到聊天里）
   - `VIEW_PIN` = 只能看日历的密码（可不设）
5. 右上 部署 → 新部署 → 类型选“网页应用”，执行身份“我”，访问权限“任何人” → 部署，复制 `/exec` 结尾的网址。
6. 把这个网址贴进 `config.js` 的 `API_URL`，再填好地址、电话、WhatsApp。
7. （已完成）网页在这个仓库的根目录，GitHub Pages 从 main 分支发布。
8. 打开 `availability.html`，登入，设好开放日期并保存（第一次保存后家长才看得到日期）。
9. 用 “ZZ TEST” 名字做测试预约，确认没问题后告诉 Claude 删除测试资料。

之后改 Apps Script 代码时：部署 → 管理部署 → 铅笔 → 版本选“新版本” → 部署（网址不变）。

## 规则
- 每节 1.5 小时；开课前 12 小时截止（马来西亚时间，Settings 可改），网页和后台都检查；老师代订不受限制。
- 每个手机号同时只能有一个未上的试课。
- 家长改期次数（默认 2）和锁定时数（默认 24）在 Settings。老师改期不算次数。
- 电话统一存成 60 开头。
- 已有预约的时段不能被调低到少于已订人数。
- 取消只会把状态改成 Cancelled，资料仍保留在 Sheet。
- 转盘：必须有预约、孩子资料齐全才可以转；每个预约一次；奖品写进 Spins，状态 Won / Used / Expired / No prize，有到期日和奖品编号。
- 查询手机号时只显示打码的名字，不显示孩子资料（PDPA）。
- 新预约、改期、取消会发邮件到 NOTIFY_EMAIL（在 Settings 填）。
