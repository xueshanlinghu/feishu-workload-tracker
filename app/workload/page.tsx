/**
 * 工作负载记录主页面
 *
 * 这是系统的核心页面，用户在这里：
 * 1. 选择日期和记录人员
 * 2. 查看已有记录
 * 3. 添加新的工作负载记录
 * 4. 提交到飞书多维表格
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import WorkloadSelector from './WorkloadSelector';
import EditRecordModal from './EditRecordModal';
import CircularProgress from './CircularProgress';
import { ToastProvider, useToast } from './ToastProvider';
import DeleteConfirmModal from './DeleteConfirmModal';
import CustomDatePicker from './CustomDatePicker';
import CustomSelect, { SelectOption } from './CustomSelect';
import packageJson from '../../package.json';

const SESSION_HEARTBEAT_INTERVAL_MS = 45 * 60 * 1000;

interface User {
  userId: string;    // user_id
  openId: string;    // open_id (用于飞书表格查询)
  name: string;
  email?: string;
  avatar?: string;
}

interface Task {
  name: string;
}

interface Record {
  id: string;
  task: string;
  workload: number;
  status: string;
}

interface NewRecord {
  task: string;
  workload: number;
}

export default function WorkloadPage() {
  return (
    <ToastProvider>
      <WorkloadPageContent />
    </ToastProvider>
  );
}

function WorkloadPageContent() {
  const { showError, showSuccess } = useToast();
  const router = useRouter();

  // 状态
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [selectedPerson, setSelectedPerson] = useState<string>('');
  const [existingRecords, setExistingRecords] = useState<Record[]>([]);
  const [existingTotal, setExistingTotal] = useState<number>(0);
  const [newRecords, setNewRecords] = useState<NewRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingRecords, setIsFetchingRecords] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Record | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [deletingRecord, setDeletingRecord] = useState<Record | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 获取当前用户信息
  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch('/api/auth/session');
        const data = await res.json();

        if (!data.authenticated) {
          router.push('/login');
          return;
        }

        setCurrentUser(data.user);
        setSelectedPerson(data.user.openId); // 使用open_id查询表格记录
      } catch (err) {
        console.error('Failed to fetch session:', err);
        router.push('/login');
      }
    }

    fetchSession();
  }, [router]);

  // 定时心跳刷新会话，避免长时间停留页面时Token失效
  useEffect(() => {
    if (!currentUser) return;

    let disposed = false;
    let intervalId: number | null = null;

    const refreshSession = async (source: 'interval' | 'visibility') => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST' });

        if (res.status === 401) {
          console.log(
            `[Session Heartbeat] Session expired on ${source}, redirecting to login...`
          );
          if (!disposed) {
            router.push('/login');
          }
          return;
        }

        if (!res.ok) {
          console.warn(
            `[Session Heartbeat] Refresh request failed on ${source}: ${res.status}`
          );
        }
      } catch (err) {
        console.error(`[Session Heartbeat] Refresh request error on ${source}:`, err);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshSession('visibility');
      }
    };

    intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshSession('interval');
      }
    }, SESSION_HEARTBEAT_INTERVAL_MS);

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [currentUser, router]);

  const refreshRecords = useCallback(async () => {
    if (!selectedDate || !selectedPerson) return;

    try {
      setIsFetchingRecords(true);

      const res = await fetch(
        `/api/feishu/records?date=${selectedDate}&person=${selectedPerson}`
      );

      if (res.status === 401) {
        console.log('Session expired while fetching records, redirecting to login...');
        router.push('/login');
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setExistingRecords(data.records);
        setExistingTotal(data.total);
      } else {
        setExistingRecords([]);
        setExistingTotal(0);
      }
    } catch (err) {
      console.error('Failed to fetch records:', err);
      setExistingRecords([]);
      setExistingTotal(0);
      showError('获取已有记录失败');
    } finally {
      setIsFetchingRecords(false);
    }
  }, [selectedDate, selectedPerson, router, showError]);

  // 获取用户列表和事项选项
  useEffect(() => {
    async function fetchInitialData() {
      try {
        setIsLoading(true);

        const [usersRes, tasksRes] = await Promise.all([
          fetch('/api/feishu/users'),
          fetch('/api/feishu/tasks'),
        ]);

        // 检查会话是否过期（401 状态码）
        if (usersRes.status === 401 || tasksRes.status === 401) {
          console.log('Session expired, redirecting to login...');
          router.push('/login');
          return;
        }

        if (usersRes.ok) {
          const usersData = await usersRes.json();
          setUsers(usersData.users);
        }

        if (tasksRes.ok) {
          const tasksData = await tasksRes.json();
          setTasks(tasksData.tasks);
        }
      } catch (err) {
        console.error('Failed to fetch initial data:', err);
        showError('获取初始数据失败');
      } finally {
        setIsLoading(false);
      }
    }

    fetchInitialData();
  }, [router, showError]);

  // 当日期或人员变化时，获取已有记录
  useEffect(() => {
    if (!selectedDate || !selectedPerson) return;
    void refreshRecords();
  }, [selectedDate, selectedPerson, refreshRecords]);

  // 添加新记录行
  const addNewRecord = () => {
    setNewRecords([...newRecords, { task: '', workload: 0 }]);
  };

  // 移除记录行
  const removeRecord = (index: number) => {
    setNewRecords(newRecords.filter((_, i) => i !== index));
  };

  // 更新记录
  const updateRecord = (index: number, field: 'task' | 'workload', value: string | number) => {
    const updated = [...newRecords];
    updated[index] = { ...updated[index], [field]: value };
    setNewRecords(updated);
  };

  // 计算新增总计
  const newTotal = newRecords.reduce((sum, r) => sum + r.workload, 0);
  const finalTotal = existingTotal + newTotal;

  // 前端验证：检查是否有无效的记录（事项为空或人力为0）
  const hasInvalidRecords = newRecords.some(r => !r.task || r.workload === 0);

  // 转换用户列表为选项格式
  const userOptions: SelectOption[] = users.map(user => ({
    value: user.openId,
    label: user.name,
    icon: 'user',
  }));

  // 转换任务列表为选项格式
  const taskOptions: SelectOption[] = tasks.map(task => ({
    value: task,
    label: task,
    icon: 'file',
  }));

  // 提交记录
  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);

      // 验证
      if (newRecords.length === 0) {
        showError('请至少添加一条记录');
        return;
      }

      if (newRecords.some(r => !r.task)) {
        showError('请填写所有事项');
        return;
      }

      if (finalTotal > 1.0) {
        showError('总人力占用不能超过1.0');
        return;
      }

      // 提交
      const res = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          personId: selectedPerson,
          records: newRecords,
        }),
      });

      // 检查会话是否过期
      if (res.status === 401) {
        console.log('Session expired while submitting, redirecting to login...');
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        // 在development模式显示详细错误
        if (process.env.NODE_ENV === 'development') {
          const detailedError = data.details ?
            `${data.error}\n\n详细信息：\n${JSON.stringify(data.details, null, 2)}` :
            data.error || '提交失败';
          throw new Error(detailedError);
        }
        throw new Error(data.error || '提交失败');
      }

      showSuccess('记录提交成功！');
      setNewRecords([]);
      await refreshRecords();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : '提交失败');
      setIsFetchingRecords(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 登出
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  // 打开编辑弹窗
  const openEditModal = (record: Record) => {
    setEditingRecord(record);
    setIsEditModalOpen(true);
  };

  // 关闭编辑弹窗
  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingRecord(null);
  };

  // 编辑成功
  const handleEditSuccess = async () => {
    showSuccess('记录更新成功！');

    // 等待飞书服务器同步数据（延迟2秒）
    await new Promise(resolve => setTimeout(resolve, 2000));
    await refreshRecords();
  };

  // 编辑失败
  const handleEditError = (errorMessage: string) => {
    showError(errorMessage);
  };

  // 打开删除确认弹窗
  const openDeleteModal = (record: Record) => {
    setDeletingRecord(record);
    setIsDeleteModalOpen(true);
  };

  // 关闭删除确认弹窗
  const closeDeleteModal = () => {
    setIsDeleteModalOpen(false);
    setDeletingRecord(null);
  };

  // 确认删除记录
  const handleDeleteConfirm = async () => {
    if (!deletingRecord) return;

    try {
      setIsDeleting(true);

      const res = await fetch(`/api/feishu/records/${deletingRecord.id}`, {
        method: 'DELETE',
      });

      // 检查会话是否过期
      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '删除失败');
      }

      showSuccess('记录删除成功！');
      closeDeleteModal();

      // 等待飞书服务器同步数据（延迟2秒）
      await new Promise(resolve => setTimeout(resolve, 2000));
      await refreshRecords();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setIsDeleting(false);
    }
  };

  // 生成Emoji表情
  const getWorkloadEmojis = (workload: number): string => {
    // 如果工作负载为0，不显示任何表情
    if (workload === 0) {
      return '';
    }

    // 限制工作负载在 0-1 范围内显示
    const clampedWorkload = Math.max(0, Math.min(1, workload));
    const filled = Math.round(clampedWorkload * 10);

    // 只显示填充的表情，不显示空表情
    return '😄'.repeat(filled);
  };

  // 根据人力占用程度获取卡片样式（色彩编码）
  const getWorkloadCardStyle = (workload: number) => {
    const percentage = (workload / 1.0) * 100;

    if (percentage >= 70) {
      // 高负载：橙红色调
      return {
        bg: 'bg-gradient-to-br from-orange-50 to-red-50',
        border: 'border-orange-200',
        textColor: 'text-orange-700',
        iconBg: 'bg-orange-100',
      };
    } else if (percentage >= 40) {
      // 中等负载：蓝色调
      return {
        bg: 'bg-gradient-to-br from-blue-50 to-indigo-50',
        border: 'border-blue-200',
        textColor: 'text-blue-700',
        iconBg: 'bg-blue-100',
      };
    } else {
      // 低负载：绿色调
      return {
        bg: 'bg-gradient-to-br from-green-50 to-emerald-50',
        border: 'border-green-200',
        textColor: 'text-green-700',
        iconBg: 'bg-green-100',
      };
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* 顶部导航栏 */}
      <header className="bg-white/80 backdrop-blur-md shadow-sm border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-black">
            人力占用记录
          </h1>
          <div className="flex items-center space-x-4">
            {currentUser && (
              <span className="text-gray-700 font-medium">
                欢迎，{currentUser.name}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-lg transition-all duration-200 font-medium hover:shadow-md"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10">
        {/* 日期和人员选择 */}
        <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-300 p-8 mb-8 border border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <CustomDatePicker
              label="选择日期"
              value={selectedDate}
              onChange={setSelectedDate}
              disabled={isFetchingRecords || isSubmitting}
            />
            <CustomSelect
              label="选择人员"
              value={selectedPerson}
              onChange={setSelectedPerson}
              options={userOptions}
              placeholder="-- 请选择人员 --"
              disabled={isFetchingRecords || isSubmitting}
              searchable={true}
              showIcon={true}
            />
          </div>
        </div>

        {/* 已有记录 */}
        <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-300 p-8 mb-8 border border-gray-100">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">已有记录</h2>
            <button
              onClick={() => {
                void refreshRecords();
              }}
              disabled={isFetchingRecords}
              className={`p-2.5 rounded-xl transition-all duration-200 ${
                isFetchingRecords
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 hover:shadow-md'
              }`}
              aria-label="刷新记录"
            >
              <svg className={`w-5 h-5 ${isFetchingRecords ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Loading状态 */}
          {isFetchingRecords && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600">正在获取记录中...</p>
            </div>
          )}

          {/* 空记录状态 */}
          {!isFetchingRecords && existingRecords.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="text-gray-400 mb-2">
                <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-gray-500">当日记录为空</p>
            </div>
          )}

          {/* 有记录时显示列表 */}
          {!isFetchingRecords && existingRecords.length > 0 && (
            <>
              <div className="space-y-4">
                {existingRecords.map((record) => {
                  const cardStyle = getWorkloadCardStyle(record.workload || 0);
                  return (
                    <div
                      key={record.id}
                      className={`flex items-center justify-between p-5 ${cardStyle.bg} border ${cardStyle.border} rounded-xl transition-all duration-300 group hover:shadow-md hover:-translate-y-0.5`}
                    >
                      <div className="flex-1">
                        <span className="font-semibold text-gray-800">{record.task || '未命名任务'}</span>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className="text-lg hidden sm:inline">{getWorkloadEmojis(record.workload || 0)}</span>
                        <span className={`font-bold text-lg min-w-[60px] text-right ${cardStyle.textColor}`}>
                          {(record.workload || 0).toFixed(1)}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(record)}
                            className={`p-2 ${cardStyle.iconBg} text-current rounded-lg transition-all duration-200 hover:scale-110`}
                            aria-label="编辑"
                            title="编辑"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => openDeleteModal(record)}
                            className="p-2 bg-red-100 text-red-600 rounded-lg transition-all duration-200 hover:bg-red-200 hover:scale-110"
                            aria-label="删除"
                            title="删除"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-8 pt-6 border-t border-gray-200 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex-1 text-center md:text-left">
                  <h3 className="text-lg font-semibold text-gray-700 mb-1">已占用人力</h3>
                  <p className="text-sm text-gray-500">当天工作负载统计</p>
                </div>
                <div className="flex justify-center">
                  <CircularProgress current={existingTotal} max={1.0} size={140} strokeWidth={12} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* 新增记录 */}
        <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-300 p-8 border border-gray-100">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">新增记录</h2>
            <button
              onClick={addNewRecord}
              disabled={isFetchingRecords}
              className={`px-5 py-2.5 rounded-xl font-medium transition-all duration-200 ${
                isFetchingRecords
                  ? 'bg-gray-400 cursor-not-allowed text-white'
                  : 'bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 shadow-md hover:shadow-lg hover:scale-105'
              }`}
            >
              + 添加记录
            </button>
          </div>

          {newRecords.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
              <div className="text-gray-400 mb-3">
                <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <p className="text-gray-500 font-medium">
                点击&quot;添加记录&quot;按钮开始记录工作
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {newRecords.map((record, index) => (
                <div key={index} className="flex gap-4 items-start bg-gray-50 p-4 rounded-xl border border-gray-200 hover:border-blue-300 transition-colors duration-200">
                  <div className="flex-1">
                    <CustomSelect
                      value={record.task}
                      onChange={(value) => updateRecord(index, 'task', value)}
                      options={taskOptions}
                      placeholder="-- 选择事项 --"
                      searchable={true}
                      showIcon={true}
                    />
                  </div>
                  <div className="w-auto">
                    <WorkloadSelector
                      value={record.workload}
                      onChange={(newValue) => updateRecord(index, 'workload', newValue)}
                      disabled={isFetchingRecords || isSubmitting}
                    />
                  </div>
                  <button
                    onClick={() => removeRecord(index)}
                    className="px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors duration-200 font-medium"
                  >
                    删除
                  </button>
                </div>
              ))}

              {/* 总计显示 */}
              <div className="mt-8 pt-6 border-t-2 border-gray-200">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700 font-medium">已有人力：</span>
                    <span className="font-bold text-lg text-gray-800">{existingTotal.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700 font-medium">新增人力：</span>
                    <span className="font-bold text-lg text-gray-800">{newTotal.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t-2 border-blue-200">
                    <span className="text-lg font-bold text-gray-900">总计：</span>
                    <span className={`text-2xl font-bold ${finalTotal > 1.0 ? 'text-red-600' : 'text-green-600'}`}>
                      {finalTotal.toFixed(1)} / 1.0
                    </span>
                  </div>
                </div>

                {finalTotal > 1.0 && (
                  <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center">
                    <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="font-medium">总人力占用超过1.0，无法提交</span>
                  </div>
                )}

                {hasInvalidRecords && (
                  <div className="mt-4 bg-orange-50 border border-orange-200 text-orange-700 px-4 py-3 rounded-xl flex items-center">
                    <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="font-medium">请完善所有记录（选择事项和人力）</span>
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || isFetchingRecords || finalTotal > 1.0 || newRecords.length === 0 || hasInvalidRecords}
                  className="w-full mt-6 px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl hover:from-blue-700 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-blue-600 disabled:hover:to-blue-500 font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-[1.02]"
                >
                  {isSubmitting ? '提交中...' : '提交记录'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 页面底部版本信息 */}
      <footer className="py-4 text-center text-sm text-gray-500 border-t border-gray-200 bg-white/50">
        <p>版本 v{packageJson.version}</p>
      </footer>

      {/* 编辑记录弹窗 */}
      <EditRecordModal
        isOpen={isEditModalOpen}
        onClose={closeEditModal}
        record={editingRecord}
        onSuccess={handleEditSuccess}
        onError={handleEditError}
        currentTotal={existingTotal}
      />

      {/* 删除确认弹窗 */}
      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={closeDeleteModal}
        onConfirm={handleDeleteConfirm}
        title="确认删除记录"
        message={`确定要删除"${deletingRecord?.task || '该'}"记录吗？此操作无法撤销。`}
        isDeleting={isDeleting}
      />
    </div>
  );
}
