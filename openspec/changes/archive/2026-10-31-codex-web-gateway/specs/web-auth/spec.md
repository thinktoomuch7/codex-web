# Spec Delta

## Purpose

让唯一的操作者用密码进入网页；没有有效会话时，系统拒绝其查看项目、会话、任务和审批。

## ADDED Requirements

### Requirement: Single-user password login

系统 SHALL 只接受配置中的一个用户用密码登录，并在成功后建立浏览器会话。

#### Scenario: Correct password

- **WHEN** 操作者提交正确的密码
- **THEN** 系统建立会话并允许进入工作区

#### Scenario: Wrong password

- **WHEN** 操作者提交错误的密码
- **THEN** 系统拒绝登录且不建立会话

### Requirement: Protected routes reject anonymous callers

系统 SHALL 拒绝没有有效会话的请求访问项目、会话、任务和审批。

#### Scenario: Anonymous request

- **WHEN** 没有有效会话的客户端请求项目列表
- **THEN** 系统拒绝该请求且不返回项目数据

### Requirement: Logout ends the browser session

系统 SHALL 在操作者退出后使当前浏览器会话失效。

#### Scenario: Logout

- **WHEN** 已登录的操作者退出
- **THEN** 该会话不能再访问受保护的数据
