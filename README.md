# 窗边手记

robot999666 的个人博客。暖纸色、鼠尾草绿与原创窗边花园插画，记录计算机学习和公开项目。

基于 Astro 7 构建页面，独立 Python/Waitress + SQLite 提供账户与投稿。首版包含 8 篇公开项目手记与 8 个精选项目；支持分类、标签、搜索、深浅主题、RSS、站点地图，以及注册登录、Markdown 写作、管理员编辑发布与投稿审核。

「夜色休息站」包含原创 Web Audio 环境音乐、每日温柔签、真实发布与更新热力图、晴夜与细雨场景、指针萤光、专注种植、漂流书签与阅读口袋。文章可以生成 PNG 阅读小卡并分享。音乐需要手动播放；签卡、专注进度和阅读口袋保存在当前浏览器。动效遵循减少动态效果设置，也可以手动关闭。

阅读版样式采用更强的深浅主题对比度：桌面正文约 19px、手机正文 18px，文章卡片摘要 17–18px、标题 23–25px。夜色花园封面包含轻量 SVG 动效，并遵循减少动态效果设置。参考 [夏夜流萤](https://blog.cuteleaf.cn/) 的封面、卡片与导航层级，未复制其图片或代码。

## 本地开发

需要 Node.js 22.12 或更新版本，以及 Python 3.12 或更新版本。

```powershell
npm ci
npm run dev
```

```powershell
npm run build
npm run verify
npm run preview
```

后端安装依赖后通过 `backend/run.py` 启动，默认只监听本机 18088。集成本地预览用 `scripts/local-preview.py` 监听 127.0.0.1:4321，并代理后端。本地测试需显式设置 `BLOG_ALLOW_INSECURE=1`、`BLOG_SECURE_COOKIE=0`、`BLOG_ORIGIN=http://127.0.0.1:4321`；生产环境禁止这些不安全设置。`BLOG_DATA_DIR` 应位于版本库之外，开发时可使用忽略的 `output/local-data`。

```powershell
python -m pip install -r backend/requirements.txt
python -m unittest discover -s backend -p 'test_*.py'
```

## 内容维护

- `/workspace/`：管理员登录后编辑已有文章、新建、发布、撤下、审核投稿；其他账户可以保存草稿和送审。修改已经公开的用户文章时，旧版保持可读，新版通过审核才替换。
- `src/content/notes/*.md` 与 `npm run seed`：生成第一次初始化的公开项目文章；数据库初始化一次后不重新覆盖在线编辑。
- `src/data/site.ts`：项目精选说明与排序。
- `src/data/github.json`：公开 GitHub 资料快照。
- `npm run sync:public`：通过无鉴权 GitHub `/users/robot999666` 公共端点更新资料，不读取私有仓库。

首版文章于 2026-10-13 依据公开 README 整理，属于项目导览，不冒充历史日记。模拟器、演示数据、Mock 接入和上游成果的边界以各篇说明与源仓库为准。公开资料快照已包含新建的博客仓库；后续可运行同步命令刷新。

## 独立部署

公网地址：<https://152.136.191.171:8088/>。原 HTTP 入口跳转到 HTTPS。

详见 [部署说明](deploy/README.md)。独立 `robot-blog.service` 在 8088 端口运行；`robot-blog-api.service` 仅监听 127.0.0.1:18088。文章和账户保存在 `/var/lib/robot-blog`，不随版本发布替换，不同步到公开 GitHub。既有 nginx 配置、9443 网站、应用进程与 MySQL 不作修改。

管理员名保留为 `robot999666`，无法通过公开注册取得管理权限。首次密码由管理员通过服务器端 `backend/manage.py bootstrap` 的标准输入设置，凭据不写入源代码、构建包、GitHub 或日志。登录使用 HTTPS、HttpOnly/Secure/SameSite 会话 Cookie、CSRF 与 Origin 校验；密码使用 scrypt 散列，审核具有文章版本冲突检查，公开内容经过 HTML 白名单清理。

部署脚本从调用者参数接收 SSH 认证文件；认证材料不得提交到版本库、放入项目或复制到服务器。项目忽略常见密钥文件与环境变量文件。GitHub Actions 只构建并校验，不持有服务器凭据。

设置环境变量 `BLOG_SITE_URL` 后重新构建，可修改 canonical、RSS 和站点地图中的站点地址。

## 设计参考

参考 [Fuwari](https://github.com/saicaca/fuwari) 的阅读体验、主题与搜索设计，以及 [Firefly](https://github.com/CuteLeaf/Firefly) 的轻盈视觉细节。代码、布局、窗边插画和内容均独立实现，未复制主题代码或素材。

## 公开资料来源

- [GitHub 主页](https://github.com/robot999666)
- [个体化 BCI 辅助控制平台](https://github.com/robot999666/Individualized-BCI-Assisted-Control-Platform)
- [家庭看护 Agent 演示](https://github.com/robot999666/harmony-care-agent)
- [教育 RAG](https://github.com/robot999666/rag_project)
- [肝脏配准探索](https://github.com/robot999666/2-ar-liver-refinenet-foundationpose)
- [Verilog 流水线 CPU](https://github.com/robot999666/verilog-conservative-pipeline-cpu)
- [数据结构学习记录](https://github.com/robot999666/data-structure-learning-record)

MIT License。公开仓库中引用的其他项目及论文仍遵循其原有许可与署名要求。
