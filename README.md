# 家庭健康信息管理系统

这是一个纯前端、本地化存储的家庭健康信息管理系统。应用不会把健康数据上传到服务器，成员信息、血糖血压、体检报告附件、服药历史和图片资料都保存在当前浏览器的 IndexedDB 中。

## 功能

- 管理家庭成员基础信息
- 记录血糖、收缩压、舒张压和测量场景
- 保存体检报告摘要和附件
- 按条目逐项添加个人药品服用历史
- 上传图片资料并按成员归档
- 在主页查看人体部位示意图
- 提供独立网页入口，点击后进入管理系统
- 用 Canvas 展示血糖血压趋势
- 一键复制或下载当前成员 Markdown 健康摘要，便于提交给 ChatGPT 整理医生判断材料

## 互联网访问

项目已配置 GitHub Pages 自动部署。推送到 `main` 后，GitHub Actions 会发布静态网页：

```text
https://zhangzhengminzzm.github.io/heather-note/
```

如果仓库首次使用 GitHub Pages，需要在 GitHub 仓库的 `Settings > Pages` 中把发布源设置为 `GitHub Actions`。

多人通过上面的地址访问的是同一个网页程序。按当前“数据本地化存储”的设计，每个人录入的数据只保存在自己的浏览器本地，不会在不同设备之间自动同步。

## 本地运行

可以直接打开 `index.html` 使用。建议使用本地静态服务运行，浏览器本地数据库行为更稳定：

```powershell
cd E:\vibeCoding\family_heather_systerm\heather-note
python -m http.server 4174
```

然后访问：

```text
http://127.0.0.1:4174
```

## 数据说明

数据保存在当前浏览器、当前站点来源下的 IndexedDB。更换浏览器、清理站点数据或使用不同端口访问，都可能看不到之前保存的数据。
