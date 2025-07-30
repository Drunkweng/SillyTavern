# SillyTavern - 功能说明

本项目是 SillyTavern 的一个特殊版本，在原版基础上进行深度修改，增加了一套完整的、基于外部数据库的用户认证系统。此修改旨在将 SillyTavern 从一个本地单用户应用，转变为一个支持多用户、可集中管理的服务端平台。

## 核心功能

- **数据库用户认证**: 替代了原有的本地用户管理，所有用户账户信息均存储在外部 MySQL 数据库中，实现了用户的集中管理和认证。
- **密码安全**: 用户密码使用 `bcrypt` 算法进行哈希加密存储，确保了账户的安全性。
- **多用户支持**:允许多个用户使用各自独立的账户登录和使用 SillyTavern，每个用户的数据（如聊天记录、角色卡等）仍然保持隔离。
- **灵活配置**: 所有数据库及认证相关的参数均可通过 `config.yaml` 文件进行灵活配置。

## 性能与代码现代化

除了核心的认证功能外，此版本还对服务器的性能和代码质量进行了显著优化：

- **全面的异步化改造**:
  - 将核心模块中的同步文件I/O操作（如 `fs.readFileSync`）全部升级为异步操作（`fs.promises.readFile`）。
  - 服务器的启动流程和核心功能现在完全基于异步 `Promise`，避免了不必要的进程阻塞，显著提升了应用的响应速度和并发处理能力。

- **优雅的异步错误处理**:
  - 引入了 `asyncHandler` 中间件来统一处理异步路由中的 `Promise` 异常。
  - 这使得代码更加简洁、健壮，并确保了在异步操作中发生的任何错误都能被妥善捕获和处理。

## 如何配置

要启用数据库认证功能，您需要在您的 `config.yaml` 文件中添加并修改以下配置项。

```yaml
# -- 数据库配置 --
# 启用数据库连接
database:
  host: "localhost"          # 数据库服务器地址
  user: "sillytavern"        # 数据库用户名
  password: "yourpassword"   # 数据库密码
  database: "sillytavern"    # 数据库名称
  port: 3306                 # 数据库端口（默认为3306）

# -- 安全与认证配置 --
# 启用用户账户系统 (必须为 true)
enableUserAccounts: true

# 启用数据库认证模式 (必须为 true)
# 当此项为 true 时，系统将通过数据库验证用户，而不会提示创建本地管理员。
enableDatabaseAuth: true

# 禁用 discreet 登录模式（建议为 false 以显示完整的登录界面）
enableDiscreetLogin: false
```

## 数据库设置

您需要在您的 MySQL 服务器上准备好相应的数据库和表。

1.  **创建数据库**:
    ```sql
    CREATE DATABASE sillytavern;
    ```

2.  **创建用户表**:
    请在您创建的数据库中执行以下 SQL 语句来创建 `users` 表。

    ```sql
    CREATE TABLE users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
    ```

    **表结构说明**:
    -   `username`: 用户名，对应 SillyTavern 的登录账号。
    -   `password`: 经 `bcrypt` 哈希后的密码字符串。
    -   `role`: 用户角色（`0` = 普通用户, `100` = 管理员）。

## 登录流程

配置完成后，启动 SillyTavern，访问主页时将看到新的登录界面。
---

通过以上修改，SillyTavern 已成功转变为一个更加健壮、安全且支持多租户的平台。

## Resources

- GitHub: <https://github.com/SillyTavern/SillyTavern>
- Docs: <https://docs.sillytavern.app/>
- Discord: <https://discord.gg/sillytavern>
- Reddit: <https://reddit.com/r/SillyTavernAI>

## License

AGPL-3.0