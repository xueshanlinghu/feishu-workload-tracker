# 飞书 API 开发文档参考

本文档整理了本项目当前实际依赖的飞书开放平台接口，以及 0.3.6 版本中已经验证通过的关键调用方式。

## 1. OAuth 与用户登录

### 1.1 获取 tenant_access_token
- 端点: `POST /open-apis/auth/v3/tenant_access_token/internal`
- 用途: 获取应用级访问令牌，供通讯录和多维表格接口使用

### 1.2 授权换取 user_access_token
- 端点: `POST /open-apis/authen/v1/access_token`
- 用途: OAuth 登录回调后换取用户令牌

### 1.3 获取当前登录用户信息
- 端点: `GET /open-apis/authen/v1/user_info`
- 用途: 建立本地 session，保存 `user_id` 与 `open_id`

## 2. 通讯录

### 2.1 按部门获取成员
- 端点: `GET /open-apis/contact/v3/users/find_by_department`
- 文档: [find_by_department](https://open.feishu.cn/document/server-docs/contact-v3/user/find_by_department)
- 用途: 根据 `FEISHU_DEPARTMENT_ID` 拉取部门成员
- 当前项目约定:
  - `department_id_type=open_department_id`
  - `user_id_type=open_id`
  - 前端和多维表格查询统一使用 `open_id`

## 3. 多维表格(Bitable)

### 3.1 查询记录
- 端点: `POST /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/search`
- 文档: [search](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/search)
- 用途: 查询已有记录，支持筛选、排序、分页

项目内已经验证通过的用法:
- `user_id_type`、`page_size`、`page_token` 放在 query string 中
- 请求体中的 `filter` 使用飞书标准格式
- 人员字段筛选可直接传用户 ID 字符串数组，例如 `["ou_xxx"]`
- 日期字段筛选使用 `["ExactDate", "时间戳字符串"]`

当前项目核心筛选条件:

```json
{
  "filter": {
    "conjunction": "and",
    "conditions": [
      {
        "field_name": "记录日期",
        "operator": "is",
        "value": ["ExactDate", "1767628800000"]
      },
      {
        "field_name": "记录人员",
        "operator": "is",
        "value": ["ou_xxx"]
      }
    ]
  }
}
```

说明:
- 这个组合筛选已经在当前生产表结构上实测通过。
- 旧版本的问题在于只取第一页 500 条并在服务端本地过滤，记录数增长后会漏查。

### 3.2 批量获取记录
- 端点: `POST /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_get`
- 文档: [batch_get](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/batch_get)
- 用途: 按 `record_id` 精确读取记录

项目内使用场景:
- 编辑记录前先读取目标记录
- 读取目标记录的 `记录日期` 与 `记录人员`
- 再结合 `search` 做“同人同日”校验

请求体示例:

```json
{
  "record_ids": ["recyOaMB2F"],
  "user_id_type": "open_id",
  "automatic_fields": true
}
```

### 3.3 批量创建记录
- 端点: `POST /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create`
- 文档: [batch_create](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/batch_create)
- 限制: 单次最多 500 条

### 3.4 更新记录
- 端点: `PUT /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}`
- 文档: [update](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/update)

### 3.5 删除记录
- 端点: `DELETE /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}`
- 文档: [delete](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/delete)

### 3.6 获取字段配置
- 端点: `GET /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields`
- 文档: [field list](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list)
- 用途: 获取字段类型、事项选项等元数据

## 4. 常见错误码

### 4.1 OAuth

| 错误码 | 含义 | 处理建议 |
| --- | --- | --- |
| `10000` | 参数错误 | 检查请求参数是否完整 |
| `10013` | 授权码无效或已过期 | 重新发起授权 |
| `20014` | token 无效 | 检查 `app_id` 和 `app_secret` |
| `99991668` | `redirect_uri` 不匹配 | 确保回调地址与平台配置完全一致 |

### 4.2 Bitable

| 错误码 | 含义 | 处理建议 |
| --- | --- | --- |
| `1254018` | `InvalidFilter` | 优先检查字段名、日期 value 格式、人员 ID 类型 |
| `1254030` | `InvalidPageToken` | 检查 `page_token` 是否与当前 `app_token/table_id` 匹配 |
| `1254045` | 字段类型不匹配 | 检查人员、日期、数字字段的传值结构 |
| `1254104` | 记录不存在 | 检查 `record_id` |

## 5. 当前项目所需权限

- `bitable:app`
- `contact:user.base:readonly`
- `contact:user.employee_id:readonly`

如果需要读取更完整的人员信息，还需要根据返回字段补充通讯录相关权限。

## 6. 0.3.6 实现说明

0.3.6 版本起，项目中的“已有记录查询 / 创建前校验 / 编辑前校验”统一改为:

1. 使用 `records/search` 做服务端筛选
2. 使用 `records/batch_get` 按 `record_id` 精确读取目标记录
3. 不再依赖“全表拉取后本地过滤”的旧实现

这样可以避免记录总数超过 500 条后出现漏查和错误校验。
