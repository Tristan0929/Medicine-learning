# 医学复习助手

一个可以分享的在线医学复习网站，包含五大功能：

- **教材梳理** —— 贴入教材，AI 提炼重点、给记忆方法；可选附上「英文名词归纳与分析」。
- **真题模拟** —— 贴入历年真题，AI 分析出题规律并生成预测模拟题（带答案解析）。
- **AI 问答** —— 贴入内容自动排版，**选中任意文字即可就地提问**，也可自由提问。
- **智能闪卡** —— 间隔重复算法安排复习，可从笔记一键生成。
- **术语表** —— 英文名词对照，可搜索、可单独导出。

所有页面都能**导出 PDF**。支持 **OpenAI / Gemini / DeepSeek / OpenRouter / 自定义**等任意「OpenAI 兼容」服务商，**每个使用者填自己的 API Key**（只存在本人浏览器，不上传、不共享）。

> 这个网站本身零依赖、纯 Node 内置模块运行，部署非常省心。

---

## 一、准备工作

你需要两个免费账号：

1. **GitHub** 账号：<https://github.com>（放代码）
2. **Render** 账号：<https://render.com>（免费部署上线）

使用者还需要一个 AI 服务商的 API Key，例如：

- DeepSeek（推荐）：<https://platform.deepseek.com/api_keys>
- OpenAI：<https://platform.openai.com>
- Kimi / Moonshot：<https://platform.moonshot.cn>
- 智谱 GLM：<https://open.bigmodel.cn>

---

## 二、把代码放到 GitHub

**方法 A：网页上传（最简单，不用装任何软件）**

1. 登录 GitHub，点右上角「+」→「New repository」。
2. 仓库名随意（如 `med-study-site`），选 **Public** 或 **Private** 都行，点「Create repository」。
3. 进入空仓库页面，点「uploading an existing file」。
4. 把本文件夹里的**所有内容**拖进去上传，注意要保留 `public` 文件夹结构：
   ```
   med-study-site/
   ├── server.js
   ├── package.json
   ├── render.yaml
   ├── README.md
   └── public/
       ├── index.html
       ├── style.css
       └── app.js
   ```
   > 小提示：可以直接把整个 `med-study-site` 文件夹里的东西拖上去。若上传后 `public` 里的文件跑到了外层，重新整理一下目录即可。
5. 点「Commit changes」完成。

**方法 B：用 Git 命令行**

```bash
cd med-study-site
git init
git add .
git commit -m "init med study site"
git branch -M main
git remote add origin https://github.com/你的用户名/med-study-site.git
git push -u origin main
```

---

## 三、在 Render 上线

1. 登录 Render，点「New +」→「**Web Service**」。
2. 连接你的 GitHub，选择刚才那个仓库。
3. 关键设置（大多会自动带出，核对一下即可）：
   - **Language / Runtime**：Node
   - **Build Command**：留空，或填 `echo no build needed`
   - **Start Command**：`npm start`
   - **Instance Type**：选 **Free**
4. 点「Create Web Service」，等待几分钟部署完成。
5. 部署成功后，页面顶部会出现一个网址，形如
   `https://med-study-site-xxxx.onrender.com`
   —— 这就是你的网站，把它分享给别人即可。

> 仓库里已带 `render.yaml`，如果你用 Render 的「Blueprint」方式，会自动读取里面的配置。

---

## 四、怎么使用

1. 打开网站，进入右上角「**设置**」。
2. 选择**服务商**（默认 DeepSeek），接口地址与默认模型会自动填好。
3. 填入你自己的 **API Key**。
4. **模型**框里填模型名即可（DeepSeek 可填 `deepseek-v4-flash` 便宜快，或 `deepseek-v4-pro` 更强）。
5. 点「**保存设置**」（可先点「测试连接」确认可用）。
6. 之后就能用五个功能页了，每页右侧都有「导出 PDF」。

各服务商对应的接口地址与常用模型（自定义时可参考）：

| 服务商 | Base URL | 常用模型 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` / `deepseek-v4-pro` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Kimi / Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |

---

## 五、需要知道的两点

- **Render 免费版会休眠**：网站闲置一段时间后，别人第一次打开可能要等约 30 秒唤醒，之后正常。
- **Key 只存本机**：每个人用自己的 Key，保存在本人浏览器里，不会上传服务器、不进代码、不共享给他人。分享网站时记得提醒对方自备 Key。

---

## 六、本地预览（可选）

装了 Node.js（18 及以上）后：

```bash
cd med-study-site
npm start
# 浏览器打开 http://localhost:3000
```

无需 `npm install`，本项目不依赖任何第三方包。
