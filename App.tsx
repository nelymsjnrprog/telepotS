import React, { useState } from 'react';
import { AppMode } from './types';
import { ChatMode } from './components/ChatMode';
import LiveMode from './components/LiveMode';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);

  return (
    <div className="w-full h-screen overflow-hidden">
      {mode === AppMode.CHAT ? (
        <ChatMode onSwitchToLive={() => setMode(AppMode.LIVE)} />
      ) : (
        <LiveMode onBack={() => setMode(AppMode.CHAT)} />
      )}
    </div>
  );
};

export default App;
