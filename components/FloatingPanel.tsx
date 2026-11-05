
import { X } from 'lucide-react';
import React from 'react';

interface FloatingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  width?: string;
}

const FloatingPanel: React.FC<FloatingPanelProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  icon,
  width = 'max-w-2xl'
}) => {
  return (
    <>
      {isOpen && (
        <>
          <div onClick={onClose} className="sgui-panel-backdrop" />

          {/* Side panel (same dialog look as the accounting system) */}
          <div role="dialog" aria-modal="true" aria-label={title} className={`sgui-side-panel ${width}`}>
            <div className="sgui-side-panel-head">
              <div>
                {icon && <span className="sgui-side-panel-icon">{icon}</span>}
                <h2>{title}</h2>
              </div>
              <button type="button" onClick={onClose} className="sgui-icon-button" aria-label="إغلاق">
                <X size={20} />
              </button>
            </div>
            <div className="sgui-side-panel-body custom-scrollbar">
              <div className="max-w-3xl mx-auto">
                {children}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default FloatingPanel;
