# 家庭健康信息管理系统

这是一个以 Python 作为后台的本地服务器网站。Python 后台负责托管网页、访问密钥登录、会话管理，并限制最多 3 个有效用户会话同时访问系统。

## 功能

- 访问密钥登录，未登录用户无法加载系统页面
- 最多 3 个有效会话同时访问
- 管理家庭成员基础信息
- 修改家庭成员个人基础信息
- 记录血糖、收缩压、舒张压和测量场景
- 保存体检报告摘要和附件
- 按条目逐项添加个人药品服用历史
- 上传图片资料并按成员归档
- 在主页查看人体部位示意图
- 用 Canvas 展示血糖血压趋势
- 一键复制或下载当前成员 Markdown 健康摘要

## 启动本地 Python 服务器

第一次启动时会自动生成 `server_config.json`，并在终端打印访问密钥。该文件包含真实密钥，已被 `.gitignore` 排除，不会提交到 Git。

```powershell
cd E:\vibeCoding\family_heather_systerm\heather-note
.\start_server.ps1
```

也可以直接运行：

```powershell
python .\server.py --host 0.0.0.0 --port 4174
```

本机访问：

```text
http://127.0.0.1:4174/
```

局域网访问：先查看本机局域网 IP，然后让同一 Wi-Fi 或内网用户访问：

```powershell
ipconfig
```

示例：

```text
http://192.168.1.25:4174/
```

## 让中国大陆任意 IP 有机会访问

代码已经让 Python 后台监听 `0.0.0.0`，这表示服务器接受来自其他机器的连接。但公网可访问还需要网络层配置：

1. Windows 防火墙放行 TCP 端口 `4174`
2. 路由器设置端口转发：公网 `4174` 转发到本机内网 IP 的 `4174`
3. 你的宽带需要有公网 IPv4，或使用 IPv6 公网地址
4. 如果运营商使用 CGNAT，没有公网入口，需要使用云服务器反向代理、frp、内网穿透或 VPN
5. 公网访问建议使用 HTTPS 反向代理，否则访问密钥和健康数据会通过 HTTP 明文传输

完成后，外部用户访问：

```text
http://你的公网IP:4174/
```

如果你使用域名并面向公网长期访问，可能还涉及域名解析、HTTPS 证书和合规备案要求。

## 密钥配置

可参考 `server_config.example.json` 创建或修改 `server_config.json`：

```json
{
  "access_keys": ["替换成你的强密钥"],
  "max_active_sessions": 3,
  "session_ttl_minutes": 480
}
```

修改配置后需要重启 Python 服务器。

## 数据说明

当前健康业务数据仍保存在访问用户浏览器的 IndexedDB 中。Python 后台负责访问控制和网页托管，不会把血糖、血压、报告、图片等数据集中保存到服务器文件。

如果需要所有用户共享同一份家庭健康数据，下一步需要把 IndexedDB 存储改成 Python 后台 API + 本机 SQLite 数据库。
