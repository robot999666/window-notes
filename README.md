# 窗边手记

robot999666 的个人博客。暖纸色、鼠尾草绿与原创窗边花园插画，记录计算机学习和公开项目。

基于 Astro 7 构建静态页面，包含项目导览、文章目录、分类筛选、本地搜索、深浅主题、RSS、站点地图与移动端布局。没有登录、追踪脚本或运行时数据库。

## 本地开发

需要 Node.js 22.12 或更新版本。

```powershell
npm ci
npm run dev
```

```powershell
npm run build
npm run verify
npm run preview
```

## 内容维护

- `src/content/notes/*.md`：新增手记，填写标题、摘要、日期、分类、标签、阅读时间与公开来源。
- `src/data/site.ts`：项目精选说明与排序。
- `src/data/github.json`：公开 GitHub 资料快照。
- `npm run sync:public`：通过无鉴权 GitHub `/users/robot999666` 公共端点更新资料，不读取私有仓库。

首版文章于 2026-10-13 依据公开 README 整理，属于项目导览，不冒充历史日记。模拟器、演示数据、Mock 接入和上游成果的边界以各篇说明与源仓库为准。公开资料快照已包含新建的博客仓库；后续可运行同步命令刷新。

## 独立部署

公网地址：<http://152.136.191.171:8088/>。

详见 [部署说明](deploy/README.md)。独立 `robot-blog.service` 在 8088 端口运行，目录 `/opt/robot-blog`。服务器只接收构建产物与专用部署文件。既有 nginx 配置、9443 网站、应用进程与数据库不作修改。

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
