# GitHub Pages 发布步骤

1. 在 GitHub 新建一个仓库，例如 `hehe-memory-gallery`。
2. 先设为 `private`，避免仓库文件公开。
3. 用 GitHub Desktop 或命令行把本目录内容推送到仓库根目录。
4. 打开仓库 `Settings` -> `Pages`。
5. Source 选择 `Deploy from a branch`。
6. Branch 选择 `main`，Folder 选择 `/root`，保存。
7. 等几分钟后，GitHub 会给出 `https://你的用户名.github.io/hehe-memory-gallery/`。

注意：普通 GitHub Pages 链接本身仍是公网可访问；仓库 private 只是不公开仓库文件，不等于服务器级私密站点。
