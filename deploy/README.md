# 独立部署

博客独立 nginx 服务在 **8088 HTTPS** 提供页面，独立 Python/Waitress API 只在 **127.0.0.1:18088** 监听。原 HTTP 8088 地址返回 308 跳转。既有 9443、80、8000、MySQL 和全局 nginx 配置保持原样；不调用其 reload、restart 或 stop。

`robot-blog.service` 限制 20% CPU、96 MB 内存；`robot-blog-api.service` 限制 30% CPU、192 MB 内存。均以 www-data 运行，代码只读，API 仅可写自己的 `/var/lib/robot-blog`。密码、会话和待审核稿件在私有 SQLite 中，不进入公开源仓库和发布包。访问日志关闭；错误日志不记录请求正文或凭据。

静态版本为 `/opt/robot-blog/releases/<版本>`，应用与隔离依赖为 `/opt/robot-blog/app-releases/<版本>`，分别通过 `current`、`app-current` 原子切换。数据独立存放；部署前使用 SQLite backup API 保存数据库备份到 root 私有目录。首版 8 篇文章只导入一次，后续发布不会覆盖后台编辑。

先在本机准备固定版本的纯 Python wheels（保存到忽略的 `output/runtime-wheels`），服务器从包内离线安装到自己的 vendor 目录，不安装系统包。构建、校验、seed 生成、上传 SHA-256 校验均通过后才进入安装阶段。

```powershell
python -m pip download --only-binary=:all: --no-deps -r backend/requirements.txt -d output/runtime-wheels
./scripts/deploy.ps1 -Server <服务器地址> -IdentityFile <本机SSH身份文件> -SkipInstall
```

SSH 身份文件只传给本机 SSH/SCP 进程，必须存放在项目目录之外。部署包明确仅允许 dist、专用 deploy 文件、后端源码/公开 seed、固定版本 wheels 和 REVISION；拒绝链接、路径穿越、重复路径和超大包。

博客 TLS 证书副本存放于 `/var/lib/robot-blog-tls`，TLS 私钥仅供本服务读取。使用服务器现有、自动续期的有效 IP 证书，以只读方式从既有证书目录同步到博客专用目录。`robot-blog-cert.timer` 每小时检查副本，只有证书更新时才 reload 博客 nginx；不改变原证书权限、原有续期流程或 9443 服务。只需云防火墙已允许 TCP **8088**。首次同步可将 `deploy/renew-certificate.sh` 上传到本站临时路径后执行 `sudo bash <临时脚本> provision`。

安装前后比较现有 nginx、als-bci、MySQL 的状态和主进程、`/etc/nginx` 文件哈希、非博客 TCP 监听的进程和地址，以及 9443/80/8000 HTTP 状态。9443 初始必须为 200；发现变化即停止本站 nginx/API，停止部署，不尝试改动其他服务。新版本自身不健康但既有服务未变时，恢复本站上一个版本、配置和服务。已有数据不自动回滚，历史版本不自动删除。

普通用户不能发布或审批；管理员保留账户 robot999666 只能通过服务器本地 bootstrap 初始化。初始密码通过标准输入传入 `backend/manage.py bootstrap`，不使用命令行参数或公开文档保存密码。忘记密码可由服务器所有者重新 bootstrap；重置会注销管理员现有会话。公开路由、搜索、RSS 和站点地图仅包含已发布文章；静态旧文章文件路径同样受动态路由控制，撤下内容不能绕过审核读取。

```bash
sudo systemctl status robot-blog.service robot-blog-api.service robot-blog-cert.timer
sudo journalctl -u robot-blog-api.service -n 60 --no-pager
curl -I https://152.136.191.171:8088/
```

停止本站可以执行 `sudo systemctl stop robot-blog.service robot-blog-api.service`；无需停止其他服务。保留数据目录与 root 私有备份，以便恢复。
