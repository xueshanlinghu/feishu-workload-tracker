/**
 * 工作负载记录 API
 *
 * GET /api/feishu/records - 查询记录
 * POST /api/feishu/records - 创建记录
 * PATCH /api/feishu/records - 更新记录
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  queryRecordsByDateAndPerson,
  createRecords,
  updateRecord,
  getRecordById,
} from '@/lib/feishu/bitable';
import {
  fromWorkloadUnits,
  isWorkloadOverLimit,
  sumWorkloadUnits,
  toWorkloadUnits,
} from '@/lib/workload';
import { isSessionValid, getCurrentUser } from '@/lib/session';
import { BitableRecord } from '@/types/feishu';

function getRecordWorkload(record: BitableRecord): number {
  const workloadCalc = record.fields['人力占用计算'] as { value?: number[] } | undefined;
  let workload = workloadCalc?.value?.[0] || 0;

  if (workload === 0) {
    const workloadInt = (record.fields['人力占用'] as number) || 0;
    workload = workloadInt / 10;
  }

  return fromWorkloadUnits(toWorkloadUnits(workload));
}

function getRecordPersonId(record: BitableRecord): string | null {
  const recordPerson = record.fields['记录人员'] as
    | Array<{ id?: string }>
    | { id?: string }
    | undefined;

  if (Array.isArray(recordPerson) && recordPerson.length > 0) {
    return recordPerson[0]?.id || null;
  }

  if (recordPerson && typeof recordPerson === 'object' && 'id' in recordPerson) {
    return recordPerson.id || null;
  }

  return null;
}

function formatRecord(record: BitableRecord) {
  return {
    id: record.record_id,
    task: (record.fields['事项'] as string) || '未命名任务',
    workload: getRecordWorkload(record),
    status: (record.fields['记录状态'] as string) || '未发周报',
    createdTime: record.created_time,
  };
}

/**
 * GET - 查询记录
 *
 * Query参数:
 * - date: 日期 (YYYY-MM-DD)
 * - person: 人员ID
 */
export async function GET(request: NextRequest) {
  try {
    const valid = await isSessionValid();
    if (!valid) {
      return NextResponse.json(
        { error: '未登录或会话已过期' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const personId = searchParams.get('person');

    if (!date || !personId) {
      return NextResponse.json(
        { error: '缺少必要参数: date 和 person' },
        { status: 400 }
      );
    }

    const records = await queryRecordsByDateAndPerson(date, personId);
    const totalWorkload = fromWorkloadUnits(
      sumWorkloadUnits(records.map((record) => getRecordWorkload(record)))
    );
    const formattedRecords = records.map(formatRecord);

    console.log(`[Records API] Found ${records.length} records for date ${date}, person ${personId}`);

    return NextResponse.json({
      records: formattedRecords,
      total: totalWorkload,
      count: formattedRecords.length,
    });
  } catch (error) {
    console.error('[Records API GET] Error:', error);
    return NextResponse.json(
      { error: '查询记录失败' },
      { status: 500 }
    );
  }
}

/**
 * POST - 创建记录
 *
 * Body:
 * {
 *   date: "2026-01-08",
 *   personId: "open_id",
 *   records: [
 *     { task: "任务名称", workload: 0.3 }
 *   ]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const valid = await isSessionValid();
    if (!valid) {
      return NextResponse.json(
        { error: '未登录或会话已过期' },
        { status: 401 }
      );
    }

    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { error: '无法获取当前用户信息' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { date, personId, records } = body;

    if (!date || !personId || !records || !Array.isArray(records)) {
      return NextResponse.json(
        { error: '请求参数不正确' },
        { status: 400 }
      );
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: '至少需要一条记录' },
        { status: 400 }
      );
    }

    const existingRecords = await queryRecordsByDateAndPerson(date, personId);
    const existingTotalUnits = sumWorkloadUnits(
      existingRecords.map((record) => getRecordWorkload(record))
    );
    const newTotalUnits = sumWorkloadUnits(
      records.map((record: { workload: number }) => record.workload)
    );
    const finalTotalUnits = existingTotalUnits + newTotalUnits;
    const existingTotal = fromWorkloadUnits(existingTotalUnits);
    const newTotal = fromWorkloadUnits(newTotalUnits);
    const finalTotal = fromWorkloadUnits(finalTotalUnits);

    if (isWorkloadOverLimit(finalTotalUnits)) {
      return NextResponse.json(
        {
          error: '总人力占用超出限制',
          detail: `已有人力 ${existingTotal.toFixed(1)} + 新增人力 ${newTotal.toFixed(1)} = ${finalTotal.toFixed(1)} > 1.0`,
        },
        { status: 400 }
      );
    }

    const dateTimestamp = new Date(date).getTime();
    const bitableRecords: BitableRecord[] = records.map((record: { task: string; workload: number }) => ({
      fields: {
        记录日期: dateTimestamp,
        记录人员: [{ id: personId }],
        事项: record.task,
        人力占用: toWorkloadUnits(record.workload),
        记录状态: '未发周报',
        创建人: [{ id: currentUser.openId }],
      },
    }));

    console.log('[Records API] Creating records:', JSON.stringify(bitableRecords, null, 2));

    const result = await createRecords(bitableRecords);

    return NextResponse.json({
      success: true,
      count: result.records.length,
      recordIds: result.records.map((record) => record.record_id),
      message: `成功创建 ${result.records.length} 条记录`,
    });
  } catch (error) {
    console.error('[Records API POST] Error:', error);

    if (process.env.NODE_ENV === 'development' && error instanceof Error) {
      return NextResponse.json(
        {
          error: '创建记录失败',
          details: {
            message: error.message,
            ...(error as any).response?.data,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: '创建记录失败' },
      { status: 500 }
    );
  }
}

/**
 * PATCH - 更新记录
 *
 * Body:
 * {
 *   recordId: "record_id",
 *   workload: 0.3
 * }
 */
export async function PATCH(request: NextRequest) {
  try {
    const valid = await isSessionValid();
    if (!valid) {
      return NextResponse.json(
        { error: '未登录或会话已过期' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { recordId, workload } = body;

    if (!recordId) {
      return NextResponse.json(
        { error: '缺少记录ID' },
        { status: 400 }
      );
    }

    if (typeof workload !== 'number' || workload < 0 || workload > 1) {
      return NextResponse.json(
        { error: '人力占用值必须在 0-1 之间' },
        { status: 400 }
      );
    }

    const targetRecord = await getRecordById(recordId);

    console.log('[Records API PATCH] targetRecord:', targetRecord ? {
      record_id: targetRecord.record_id,
      事项: targetRecord.fields['事项'],
      人力占用: targetRecord.fields['人力占用'],
      人力占用计算: targetRecord.fields['人力占用计算'],
      记录日期: targetRecord.fields['记录日期'],
      记录人员: targetRecord.fields['记录人员'],
    } : null);

    if (!targetRecord) {
      return NextResponse.json(
        { error: '记录不存在' },
        { status: 404 }
      );
    }

    const recordDate = targetRecord.fields['记录日期'];
    if (typeof recordDate !== 'number') {
      return NextResponse.json(
        { error: '无法获取记录日期信息' },
        { status: 400 }
      );
    }

    const personId = getRecordPersonId(targetRecord);
    if (!personId) {
      return NextResponse.json(
        { error: '无法获取记录人员信息' },
        { status: 400 }
      );
    }

    const personRecords = await queryRecordsByDateAndPerson(recordDate, personId);

    console.log('[Records API PATCH] personRecords count:', personRecords.length);

    const existingTotalUnits = sumWorkloadUnits(
      personRecords
        .filter((record) => record.record_id !== recordId)
        .map((record) => getRecordWorkload(record))
    );
    const newWorkloadUnits = toWorkloadUnits(workload);
    const updatedTotalUnits = existingTotalUnits + newWorkloadUnits;
    const existingTotal = fromWorkloadUnits(existingTotalUnits);
    const updatedTotal = fromWorkloadUnits(updatedTotalUnits);

    console.log(
      '[Records API PATCH] existingTotal (excluding current):',
      existingTotal,
      'newWorkload:',
      workload,
      'total:',
      updatedTotal
    );

    if (isWorkloadOverLimit(updatedTotalUnits)) {
      return NextResponse.json(
        {
          error: '总人力占用超出限制',
          detail: `该日期其他记录占用 ${existingTotal.toFixed(1)}，更新后将达到 ${updatedTotal.toFixed(1)} > 1.0`,
        },
        { status: 400 }
      );
    }

    const updated = await updateRecord(recordId, {
      人力占用: newWorkloadUnits,
    });

    return NextResponse.json({
      success: true,
      record: updated,
      message: '记录更新成功',
    });
  } catch (error) {
    console.error('[Records API PATCH] Error:', error);

    if (process.env.NODE_ENV === 'development' && error instanceof Error) {
      return NextResponse.json(
        {
          error: '更新记录失败',
          details: {
            message: error.message,
            ...(error as any).response?.data,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: '更新记录失败' },
      { status: 500 }
    );
  }
}
