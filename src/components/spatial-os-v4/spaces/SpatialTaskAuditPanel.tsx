'use client';

import { useCallback, useEffect, useState } from 'react';
import { fridayTaskEventStore, type TaskAuditSummary } from '@/lib/friday/dexie-task-event-store';

const STATUS_LABEL: Record<TaskAuditSummary['status'], string> = {
  queued: '排队中',
  running: '执行中',
  waiting: '等待中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function SpatialTaskAuditPanel() {
  const [items, setItems] = useState<TaskAuditSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setItems(await fridayTaskEventStore.listRecentTaskAudit());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="spatial-v4-task-audit" aria-labelledby="spatial-v4-task-audit-title">
      <div className="spatial-v4-task-audit-heading">
        <div>
          <span className="spatial-v4-card-kicker">LOCAL TASK HISTORY</span>
          <h2 id="spatial-v4-task-audit-title">任务审计</h2>
          <p>显示最近 50 个任务的状态摘要。不会展示用户提示词、输入、结果或原始事件负载。</p>
        </div>
        <button type="button" className="spatial-v4-action-button" onClick={() => void refresh()} disabled={loading}>
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>

      {error ? (
        <p className="spatial-v4-task-audit-message" role="status">本地任务记录暂时无法读取，请稍后重试。</p>
      ) : loading && items.length === 0 ? (
        <p className="spatial-v4-task-audit-message" role="status">正在读取本地任务记录…</p>
      ) : items.length === 0 ? (
        <p className="spatial-v4-task-audit-message">还没有可显示的任务记录。</p>
      ) : (
        <ul className="spatial-v4-task-audit-list">
          {items.map((item) => (
            <li key={item.taskId} className="spatial-v4-task-audit-row">
              <div className="spatial-v4-task-audit-copy">
                <strong>{item.agent}</strong>
                <code>{item.taskId}</code>
                <span>{item.eventCount} 个事件 · {new Date(item.updatedAt).toLocaleString()}</span>
                {item.errorCode ? <span>错误代码：{item.errorCode}</span> : null}
              </div>
              <div className="spatial-v4-task-audit-tags">
                <span data-status={item.status}>{STATUS_LABEL[item.status]}</span>
                {item.sideEffect ? <span>有副作用</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
