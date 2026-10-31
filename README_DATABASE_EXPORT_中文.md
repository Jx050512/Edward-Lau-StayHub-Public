# StayHub — Database Export（管理员报表导出）

## 功能
- Admin 左侧新菜单 **Database export**。
- Excel（.xlsx）：一个工作簿，包含 Summary、Customers、Bookings、Demo Payments、Properties、Room Inventory 六个标签页。
- CSV（.csv）：一次选择一个分类导出。
- 只有已完成 MFA 登录且服务器确认 `role=admin` 的账号可以下载，顾客不可以。
- 导出的姓名和邮箱会遮罩；**不会包含完整邮箱、密码/密码哈希、OTP、Session Token、电话、留言、环境变量**。
- 所有金额均标注为模拟款项，不涉及真实支付。
- CSV 处理了 Excel 公式注入，Excel 是真正的 .xlsx 格式。
- 每个分类最多支持 5000 行，超过时会拒绝导出，不会静默截断。

## 安装和更新（必须顺序执行）
1. **先更新 Public GitHub 仓库**：把 Public Patch ZIP 内文件解压覆盖到 Public 仓库根目录，保留 `netlify` 文件夹结构；提交并推送至 `main`。Netlify 会自动发布新的 Public Functions。
2. **再更新 Admin GitHub 仓库**：把 Admin Patch ZIP 内文件解压覆盖到 Admin 仓库根目录；提交并推送至 `main`。Netlify 会自动发布 Admin。
3. 访问 `https://stayhub-admin.netlify.app`；重新登录（含 OTP）；点击左侧 **Database export**。
4. 点 **Download complete Excel**，或选择分类点击 **Download CSV**。

**不需要新增数据库迁移，也不需要新增任何 Netlify 环境变量。** 不需要修改当前 Gmail SMTP 配置。两次 GitHub 推送各触发自己的站点部署。

## 请勿混淆
管理员导出的 Excel / CSV 是**经脱敏的业务报表**，不是完整 PostgreSQL 数据库备份。老师需要的 `.sql` Export 仍应单独准备（例如之前整理的 Schema + Demo Data，或经隐私清理的 pg_dump）。

## 可选检查
Public 仓库内：
```powershell
node --check netlify/functions/api.mjs
node --check netlify/functions/report-export.mjs
node --check netlify/functions/xlsx-lite.mjs
npm test
```
Admin 仓库内：
```powershell
node --check site/assets/admin.js
```

## 安全提醒
- 下载的数据依然包含订单、客户 ID、住房日期等信息，只限课堂展示或授权人员查看，勿上传到公共 GitHub。
- 丢失或分享 .xlsx/.csv 文件后，系统无法撤回下载内容。
- 保持 Public API 和 Admin 的现有管理员 MFA、HTTPS 与权限管理。
