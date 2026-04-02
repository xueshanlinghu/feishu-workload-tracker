/**
 * 飞书多维表格(Bitable) API 操作
 */

import { feishuClient } from './client';
import { getTenantAccessToken } from './auth';
import { config } from '../config';
import {
  BitableRecord,
  QueryRecordsResponse,
  CreateRecordsResponse,
  BatchGetRecordsResponse,
  BitableField,
} from '@/types/feishu';

type UserIdType = 'open_id' | 'union_id' | 'user_id';
type FilterOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'doesNotContain'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'isGreater'
  | 'isGreaterEqual'
  | 'isLess'
  | 'isLessEqual';

interface RecordFilterCondition {
  field_name: string;
  operator: FilterOperator;
  value?: string[];
}

interface RecordFilterGroup {
  conjunction: 'and' | 'or';
  conditions?: RecordFilterCondition[];
  children?: RecordFilterGroup[];
}

export interface RecordFilter {
  view_id?: string;
  field_names?: string[];
  sort?: Array<{
    field_name: string;
    desc?: boolean;
  }>;
  filter?: RecordFilterGroup;
  automatic_fields?: boolean;
  page_size?: number;
  page_token?: string;
  user_id_type?: UserIdType;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

function buildSearchUrl(
  appToken: string,
  tableId: string,
  pageSize: number,
  userIdType: UserIdType,
  pageToken?: string
): string {
  const params = new URLSearchParams({
    page_size: String(pageSize),
    user_id_type: userIdType,
  });

  if (pageToken) {
    params.set('page_token', pageToken);
  }

  return `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search?${params.toString()}`;
}

function toExactDateValue(dateOrTimestamp: string | number): string[] {
  const timestamp =
    typeof dateOrTimestamp === 'number'
      ? dateOrTimestamp
      : new Date(dateOrTimestamp).getTime();

  if (!Number.isFinite(timestamp)) {
    throw new Error(`无效的日期参数: ${dateOrTimestamp}`);
  }

  return ['ExactDate', String(timestamp)];
}

/**
 * 查询多维表格记录
 */
export async function queryRecords(
  appToken: string = config.feishu.appToken,
  tableId: string = config.feishu.tableId,
  options: RecordFilter = {}
): Promise<QueryRecordsResponse> {
  try {
    const token = await getTenantAccessToken();
    const client = feishuClient.withAuth(token);
    const {
      page_size = DEFAULT_PAGE_SIZE,
      page_token,
      user_id_type = 'open_id',
      ...body
    } = options;
    const safePageSize = Math.min(Math.max(page_size, 1), MAX_PAGE_SIZE);
    const url = buildSearchUrl(
      appToken,
      tableId,
      safePageSize,
      user_id_type,
      page_token
    );

    return await client.post<QueryRecordsResponse>(url, body);
  } catch (error) {
    console.error('Failed to query records:', error);
    throw new Error('查询记录失败');
  }
}

/**
 * 按日期和人员在服务端筛选记录。
 */
export async function queryRecordsByDateAndPerson(
  date: string | number,
  personId: string
): Promise<BitableRecord[]> {
  try {
    console.log('[Bitable Query] Querying records for date:', date, 'person:', personId);

    const records: BitableRecord[] = [];
    let pageToken: string | undefined;

    do {
      const response = await queryRecords(config.feishu.appToken, config.feishu.tableId, {
        page_size: MAX_PAGE_SIZE,
        page_token: pageToken,
        user_id_type: 'open_id',
        automatic_fields: true,
        field_names: [
          '记录日期',
          '记录人员',
          '事项',
          '人力占用',
          '人力占用计算',
          '记录状态',
        ],
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: '记录日期',
              operator: 'is',
              value: toExactDateValue(date),
            },
            {
              field_name: '记录人员',
              operator: 'is',
              value: [personId],
            },
          ],
        },
      });

      records.push(...(response.items || []));
      pageToken = response.has_more ? response.page_token : undefined;
    } while (pageToken);

    console.log('[Bitable Query] Found', records.length, 'records from server-side filter');
    return records;
  } catch (error) {
    console.error('Failed to query records by date and person:', error);
    throw new Error('查询指定日期和人员的记录失败');
  }
}

/**
 * 按记录 ID 批量获取记录。
 */
export async function batchGetRecords(
  recordIds: string[],
  appToken: string = config.feishu.appToken,
  tableId: string = config.feishu.tableId,
  userIdType: UserIdType = 'open_id'
): Promise<BitableRecord[]> {
  try {
    if (recordIds.length === 0) {
      return [];
    }

    if (recordIds.length > 100) {
      throw new Error('一次最多获取100条记录');
    }

    const token = await getTenantAccessToken();
    const client = feishuClient.withAuth(token);
    const url = `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_get`;
    const response = await client.post<BatchGetRecordsResponse>(url, {
      record_ids: recordIds,
      user_id_type: userIdType,
      automatic_fields: true,
    });

    return response.records || [];
  } catch (error) {
    console.error('Failed to batch get records:', error);
    throw new Error('批量获取记录失败');
  }
}

/**
 * 获取单条记录。
 */
export async function getRecordById(
  recordId: string,
  appToken: string = config.feishu.appToken,
  tableId: string = config.feishu.tableId,
  userIdType: UserIdType = 'open_id'
): Promise<BitableRecord | null> {
  const records = await batchGetRecords([recordId], appToken, tableId, userIdType);
  return records[0] || null;
}

/**
 * 批量创建记录
 */
export async function createRecords(
  records: BitableRecord[],
  appToken: string = config.feishu.appToken,
  tableId: string = config.feishu.tableId
): Promise<CreateRecordsResponse> {
  try {
    if (records.length === 0) {
      throw new Error('记录列表不能为空');
    }

    if (records.length > 500) {
      throw new Error('一次最多创建500条记录');
    }

    const token = await getTenantAccessToken();
    const client = feishuClient.withAuth(token);
    const url = `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`;
    const response = await client.post<CreateRecordsResponse>(url, {
      records,
    });

    console.log(`[Bitable] Created ${records.length} records`);
    return response;
  } catch (error) {
    console.error('Failed to create records:', error);
    throw new Error('创建记录失败');
  }
}

/**
 * 更新单条记录
 */
export async function updateRecord(
  recordId: string,
  fields: Record<string, unknown>,
  appToken: string = config.feishu.appToken,
  tableId: string = config.feishu.tableId
): Promise<BitableRecord> {
  try {
    const token = await getTenantAccessToken();
    const client = feishuClient.withAuth(token);
    const url = `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`;
    const response = await client.put<{ record: BitableRecord }>(url, {
      fields,
    });

    return response.record;
  } catch (error) {
    console.error('Failed to update record:', error);
    throw new Error('更新记录失败');
  }
}

/**
 * 删除记录
 */
export async function deleteRecord(
  recordId: string,
  appToken: string = config.feishu.appToken,
  tableId: string = config.feishu.tableId
): Promise<void> {
  try {
    const token = await getTenantAccessToken();
    const client = feishuClient.withAuth(token);
    const url = `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`;

    await client.delete(url);
    console.log(`[Bitable] Deleted record ${recordId}`);
  } catch (error) {
    console.error('Failed to delete record:', error);
    throw new Error('删除记录失败');
  }
}

/**
 * 获取表格所有字段配置
 */
export async function getTableFields(
  appToken: string = config.feishu.appToken,
  tableId: string = config.feishu.tableId
): Promise<BitableField[]> {
  try {
    const token = await getTenantAccessToken();
    const client = feishuClient.withAuth(token);
    const url = `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`;
    const response = await client.get<{ items: BitableField[] }>(url);

    return response.items;
  } catch (error) {
    console.error('Failed to get table fields:', error);
    throw new Error('获取字段配置失败');
  }
}

/**
 * 从字段配置中提取"事项"字段的选项列表
 */
export async function getTaskOptions(): Promise<string[]> {
  try {
    const fields = await getTableFields();
    const taskField = fields.find((field) => field.field_name === '事项');

    if (!taskField || !taskField.property) {
      console.warn('未找到"事项"字段或字段没有配置选项');
      return [];
    }

    const options = (taskField.property as { options?: Array<{ name: string }> })
      ?.options;

    if (!options) {
      return [];
    }

    return options.map((opt) => opt.name);
  } catch (error) {
    console.error('Failed to get task options:', error);
    throw new Error('获取事项选项失败');
  }
}
