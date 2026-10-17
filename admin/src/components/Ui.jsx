import React from 'react';
import { statuses } from '../api';

export function Status({ value }) {
  return (
    <span className={`status status--${value?.toLowerCase()}`}>{statuses[value] || value}</span>
  );
}
export function Empty({ title = '暂无数据', hint = '这里会显示新的记录。' }) {
  return (
    <div className="empty">
      <div className="empty__symbol">✦</div>
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}
export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-header__action">{action}</div>}
    </div>
  );
}
export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({ title, onClose, children, wide = false }) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Notice({ message, onClose }) {
  return (
    message && (
      <div className="notice" role="alert">
        {message}
        <button onClick={onClose} aria-label="关闭提示">
          ×
        </button>
      </div>
    )
  );
}
