import React, { useState, useEffect } from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  CloudSync,
  UploadCloud
} from 'lucide-react';
import { networkManager } from '../services/cnNetworkManager.js';

export default function SyncIndicator() {
  const [isOnline, setIsOnline] = useState(networkManager.getEffectiveOnlineStatus());
  const [simMode, setSimMode] = useState(networkManager.simulatedMode);
  const [syncStatus, setSyncStatus] = useState('IDLE'); // 'IDLE' | 'SYNCING' | 'SUCCESS' | 'ERROR'
  const [syncMessage, setSyncMessage] = useState('');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const unsubNet = networkManager.subscribe((data) => {
      setIsOnline(data.isOnline);
      setSimMode(data.simulatedMode);
      setPendingCount(data.pendingSyncCount || 0);
    });

    const unsubSync = networkManager.subscribeSync((evt) => {
      setSyncStatus(evt.status);
      setSyncMessage(evt.details);
      if (evt.status === 'SUCCESS') {
        setTimeout(() => setSyncStatus('IDLE'), 3500);
      }
    });

    networkManager.checkPendingSync();

    return () => {
      unsubNet();
      unsubSync();
    };
  }, []);

  const handleManualSync = () => {
    networkManager.triggerAutoSync();
  };

  return (
    <div className="flex items-center gap-2">
      {/* Network Status Pill */}
      <div
        className={`px-3 py-1.5 rounded-full border text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all ${
          !isOnline
            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
            : simMode === 'flaky' || simMode === 'slow3g'
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
        }`}
      >
        {!isOnline ? (
          <>
            <WifiOff className="w-3.5 h-3.5 text-rose-400" />
            <span>Offline Mode</span>
          </>
        ) : (
          <>
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span>Online</span>
            {simMode !== 'normal' && (
              <span className="text-[10px] text-amber-400 font-mono">({simMode})</span>
            )}
          </>
        )}
      </div>

      {/* Sync Status & Action Button */}
      {pendingCount > 0 && (
        <button
          onClick={handleManualSync}
          disabled={!isOnline || syncStatus === 'SYNCING'}
          className={`px-3 py-1.5 rounded-full border text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all ${
            !isOnline
              ? 'bg-slate-800 border-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-indigo-900/30'
          }`}
          title="Synchronize offline routes with server"
        >
          <UploadCloud className={`w-3.5 h-3.5 ${syncStatus === 'SYNCING' ? 'animate-bounce' : ''}`} />
          <span>Sync ({pendingCount} pending)</span>
        </button>
      )}

      {syncStatus === 'SYNCING' && (
        <span className="text-xs text-indigo-400 flex items-center gap-1 animate-pulse">
          <RefreshCw className="w-3 h-3 animate-spin" />
          <span>Syncing...</span>
        </span>
      )}

      {syncStatus === 'SUCCESS' && (
        <span className="text-xs text-emerald-400 flex items-center gap-1 animate-fade-in">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Synced!</span>
        </span>
      )}
    </div>
  );
}
