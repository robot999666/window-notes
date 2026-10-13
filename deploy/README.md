# 独立部署

静态站点由独立的 `robot-blog.service` 提供，监听 **8088**。该服务以 `www-data` 运行，使用自己的 nginx 配置和 PID。部署不会调用现有 nginx、als-bci 或 MySQL 服务的 reload、restart 或 stop，也不会修改它们的配置。

服务限制为一个 worker、20% CPU 配额和 96 MB 内存。网站文件只读；错误日志进入 systemd journal，不记录访问日志。运行时写入仅使用 `/run/robot-blog`。网站未知路径返回真实的 404，HTML 不长期缓存，构建产生的带哈希资源可以长期缓存。

在仓库根目录执行：

```powershell
./scripts/deploy.ps1 -Server <服务器地址> -IdentityFile <本机SSH身份文件>
```

身份文件只传给本机 SSH 和 SCP 进程，不会被复制到构建包、仓库或服务器。上传内容明确限制为 `dist`、`deploy` 和 `REVISION`。构建包校验 SHA-256 后才会安装。

默认先执行 `npm ci`，再执行 `npm run build` 和 `npm run verify`。如果已经安装并验证本地依赖，可加 `-SkipInstall` 跳过依赖安装；构建和验证仍会执行。脚本提示安装成功后，请另外验证公网访问，服务器本机检查无法代替云防火墙检查。

安装路径为 `/opt/robot-blog`，发布版本存放在 `releases/<版本>`，`current` 是原子切换的符号链接。首次安装只增加本服务的配置、systemd unit 和管理标记，后续部署不会覆盖服务配置。重名服务、非本站管理的目录或被占用的 8088 端口会使部署停止。

部署前后会比较现有三个服务的状态及主进程、`/etc/nginx` 文件哈希、现有 TCP 监听进程，以及 9443、80 和 8000 的本机 HTTP 状态码。9443 部署前必须返回 200。发生变化时会停止本站服务；只删除该次运行新增的 8088 UFW 规则。新版本自身不健康且现有服务没有变化时，会恢复上一个版本。

如果 UFW 已启用，仅按需增加 `8088/tcp` 规则。云平台的安全组或防火墙仍需允许 TCP 8088，公网地址为 `http://<服务器地址>:8088/`。

排查本站：

```bash
sudo systemctl status robot-blog.service
sudo journalctl -u robot-blog.service -n 80 --no-pager
curl -I http://127.0.0.1:8088/
```

停止本站：

```bash
sudo systemctl disable --now robot-blog.service
```

请保留发布目录，按需要手工切回已知健康版本。安装脚本不会自动删除历史版本，也不会执行系统包更新、容器重建或服务器重启。
