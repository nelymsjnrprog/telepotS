import React, { useState, useRef, useEffect } from 'react';
import { Message, GroundingMetadata } from '../types';
import { sendMessage, generateSpeech, transcribeAudio } from '../services/gemini';
import { decodeBase64, decodeAudioData } from '../services/audioUtils';

interface ChatModeProps {
  onSwitchToLive: () => void;
}

export const ChatMode: React.FC<ChatModeProps> = ({ onSwitchToLive }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  const [isTTSEnabled, setIsTTSEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Knowledge Base State
  const [ingestionLog, setIngestionLog] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  
  // Chat History State
  const [chatHistory, setChatHistory] = useState<{id: string, title: string, messages: Message[]}[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(Date.now().toString());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasStarted = messages.length > 0;

  // Load Data from LocalStorage
  useEffect(() => {
    const savedKB = localStorage.getItem('telepot_kb_log');
    if (savedKB) setIngestionLog(JSON.parse(savedKB));
    
    const savedSync = localStorage.getItem('telepot_kb_sync');
    if (savedSync) setLastSync(parseInt(savedSync));

    const savedHistory = localStorage.getItem('telepot_chat_history');
    if (savedHistory) setChatHistory(JSON.parse(savedHistory));
  }, []);

  // Persist Data
  useEffect(() => {
    localStorage.setItem('telepot_kb_log', JSON.stringify(ingestionLog));
    if (lastSync) localStorage.setItem('telepot_kb_sync', lastSync.toString());
  }, [ingestionLog, lastSync]);

  useEffect(() => {
    localStorage.setItem('telepot_chat_history', JSON.stringify(chatHistory));
  }, [chatHistory]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [inputText]);

  const saveCurrentSession = () => {
      if (messages.length === 0) return;
      
      const title = messages.find(m => m.role === 'user')?.text.slice(0, 30) + "..." || "New Chat";
      
      setChatHistory(prev => {
          const existing = prev.findIndex(h => h.id === currentSessionId);
          if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = { id: currentSessionId, title, messages };
              return updated;
          } else {
              return [{ id: currentSessionId, title, messages }, ...prev];
          }
      });
  };

  const startNewChat = () => {
      saveCurrentSession();
      setMessages([]);
      setIngestionLog([]);
      setCurrentSessionId(Date.now().toString());
      setMobileMenuOpen(false);
  };

  const loadHistory = (sessionId: string) => {
      saveCurrentSession();
      const session = chatHistory.find(h => h.id === sessionId);
      if (session) {
          setMessages(session.messages);
          setCurrentSessionId(session.id);
          setMobileMenuOpen(false);
      }
  };

  const handleSend = async () => {
    if (!inputText.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: inputText,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    try {
      const history = messages
        .filter(m => (m.role === 'user' || m.role === 'model') && !m.isSystemReport)
        .map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        }));

      const { text: responseText, groundingMetadata } = await sendMessage(history, userMsg.text, isThinkingMode);

      if (groundingMetadata?.groundingChunks) {
          const newSources = groundingMetadata.groundingChunks
              .filter(c => c.web?.title)
              .map(c => `Indexed: ${c.web!.title.slice(0, 30)}...`);
          if (newSources.length > 0) {
              setIngestionLog(prev => [...newSources, ...prev].slice(0, 20));
              setLastSync(Date.now());
          }
      }

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText || "No response generated.",
        timestamp: Date.now(),
        isThinking: isThinkingMode,
        groundingMetadata
      };

      setMessages(prev => [...prev, aiMsg]);

      if (isTTSEnabled && responseText) {
        playTTS(responseText);
      }

    } catch (err: any) {
      console.error(err);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        text: "Error: Unable to process request.",
        timestamp: Date.now()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGlobalScan = async () => {
      setIsLoading(true);
      const scanId = Date.now().toString();
      
      setMessages(prev => [...prev, {
        id: scanId,
        role: 'system',
        text: "INITIATING GLOBAL INTEL SCAN...",
        timestamp: Date.now(),
        isSystemReport: true
      }]);

      try {
          const prompt = "SYSTEM_AUTOMATION: Conduct a comprehensive GLOBAL INTEL SCAN. List current trending issues and major events for major countries worldwide. Include specific entries for: USA, UK, China, Russia, India, Brazil, Nigeria, South Africa, Japan, Germany, France, Australia. Format as: '• [Country/Region] TREND: [Concise Summary]'. Ensure coverage of all continents.";
          const history: any[] = [];
          const { text: responseText, groundingMetadata } = await sendMessage(history, prompt, false); 

          if (groundingMetadata?.groundingChunks) {
            const newSources = groundingMetadata.groundingChunks
                .filter(c => c.web?.title)
                .map(c => `FETCHED: ${c.web!.title.slice(0, 30)}...`);
            if (newSources.length > 0) {
                setIngestionLog(prev => [...newSources, ...prev].slice(0, 20));
                setLastSync(Date.now());
            }
          }

          const reportMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'model',
            text: responseText || "Scan Failed.",
            timestamp: Date.now(),
            isSystemReport: true, 
            groundingMetadata
          };
          setMessages(prev => [...prev, reportMsg]);

      } catch (err) {
          console.error("Scan failed", err);
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            text: "Scan Failed.",
            timestamp: Date.now(),
            isSystemReport: true
        }]);
      } finally {
          setIsLoading(false);
      }
  };

  const playTTS = async (text: string) => {
    try {
      const base64 = await generateSpeech(text);
      if (base64) {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const buffer = await decodeAudioData(decodeBase64(base64), audioContext);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
      }
    } catch (e) {
      console.error("TTS Playback Failed", e);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsLoading(true); 
        try {
            const transcript = await transcribeAudio(audioBlob);
            setInputText(prev => (prev ? prev + " " + transcript : transcript));
        } catch (e) {
            console.error("Transcription failed", e);
        } finally {
            setIsLoading(false);
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone access denied.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="flex h-screen bg-ai-bg font-sans text-ai-text overflow-hidden selection:bg-ai-accent selection:text-white relative">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-purple-900/10 rounded-full blur-[120px] animate-pulse-slow"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-900/10 rounded-full blur-[120px] animate-float"></div>
      </div>

      {/* Grok-Style Header Logo (Visible Only in Hero State) */}
      {!hasStarted && (
        <div className="absolute top-6 left-0 right-0 flex justify-center items-center gap-2 z-10 animate-fade-in pointer-events-none select-none">
            <div className="flex items-center gap-2 opacity-80">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                    <path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2-1-2-1-2 1 2 1zm0-3.5L6 7l6 3 6-3-6-2.5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
                </svg>
                <h1 className="text-xl md:text-2xl font-bold text-white tracking-widest font-sans">TELEPOT</h1>
            </div>
        </div>
      )}

      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden animate-fade-in"
            onClick={() => setMobileMenuOpen(false)}
          />
      )}

      {/* Responsive Sidebar */}
      <div className={`
          fixed z-40 transition-all duration-300 ease-in-out
          inset-y-0 left-0 w-[280px]
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:top-4 md:bottom-4 md:left-4
          ${sidebarOpen ? 'md:w-[280px] md:opacity-100' : 'md:w-0 md:opacity-0 md:pointer-events-none'}
      `}>
        <div className="h-full glass-panel flex flex-col overflow-hidden shadow-2xl md:rounded-2xl border-r md:border-r-0 border-white/10">
            <div className="p-6 pb-2">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 relative flex items-center justify-center">
                        <div className="absolute inset-0 bg-white/20 rounded-full animate-heartbeat"></div>
                        <div className="w-3 h-3 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
                    </div>
                    <h1 className="font-bold text-xl tracking-tight text-white">TELEPOT</h1>
                </div>

                <button 
                    onClick={startNewChat}
                    className="w-full text-left px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-sm text-white transition-all flex items-center gap-3 font-medium border border-white/5 hover:border-white/20 group"
                >
                     <div className="w-6 h-6 rounded-full bg-ai-accent/20 text-ai-accent flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    </div>
                    New Chat
                </button>
            </div>

            {/* Scrollable Menu Items */}
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
                
                {/* Voice Button with Waveform Icon */}
                <button 
                    onClick={() => {
                        onSwitchToLive();
                        setMobileMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 text-ai-subtext hover:text-white text-sm transition-all flex items-center gap-3 group"
                >
                        <div className="w-5 h-5 flex items-center justify-center group-hover:text-ai-accent transition-colors">
                             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 3v18M8 8v8M16 8v8M4 11v2M20 11v2" />
                             </svg>
                        </div>
                        Voice
                </button>
                <div className="h-px bg-white/5 my-2 mx-2"></div>

                <button onClick={() => handleGlobalScan()} className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 text-ai-subtext hover:text-white text-sm transition-all flex items-center gap-3">
                     <span className="w-5 h-5 flex items-center justify-center">🌐</span>
                     Global Scan
                </button>

                {/* History Section */}
                {chatHistory.length > 0 && (
                    <div className="mt-4 px-2">
                        <p className="text-xs font-bold text-ai-subtext/40 uppercase tracking-wider mb-2">History</p>
                        <div className="space-y-1">
                            {chatHistory.map(session => (
                                <button
                                    key={session.id}
                                    onClick={() => loadHistory(session.id)}
                                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-ai-subtext hover:text-white truncate transition-colors"
                                >
                                    {session.title}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* Database Status */}
                 <div className="mt-6 px-2">
                    <div className="flex items-center justify-between mb-2 px-2">
                         <p className="text-xs font-bold text-ai-subtext/40 uppercase tracking-wider">Database</p>
                         {lastSync && <span className="text-[10px] text-ai-subtext/60">{new Date(lastSync).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>}
                    </div>
                    
                    <div className="bg-black/40 rounded-lg p-3 border border-white/5 font-mono text-[10px] h-32 overflow-hidden relative group">
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80 pointer-events-none"></div>
                        <div className="space-y-1 text-ai-subtext/80">
                            {ingestionLog.length === 0 ? (
                                <span className="opacity-50 italic">Waiting for ingestion...</span>
                            ) : (
                                ingestionLog.map((log, i) => (
                                    <div key={i} className="truncate hover:text-white transition-colors">
                                        <span className="text-ai-accent">{'>'}</span> {log}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/5">
                <div className="text-xs text-ai-subtext/40 text-center">
                    Your space travel is here.
                </div>
            </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col h-full relative transition-all duration-300 w-full ${sidebarOpen ? 'md:ml-[310px]' : 'md:ml-0'}`}>
         
         {/* Hamburger Menu (Mobile Only) */}
         <div className="absolute top-4 left-4 z-20 md:hidden">
            <button 
                onClick={() => setMobileMenuOpen(true)}
                className="p-2.5 rounded-xl bg-white/5 backdrop-blur-md border border-white/10 text-white shadow-lg active:scale-95 transition-all"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            </button>
         </div>

         {/* Messages Scroll Area */}
         <div className="flex-1 overflow-y-auto px-4 md:px-0 pt-20 pb-40 scroll-smooth">
            <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((msg) => (
                    <div 
                        key={msg.id} 
                        className={`group flex gap-4 animate-fade-in ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                    >
                        <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${
                            msg.role === 'user' 
                                ? 'bg-ai-surface border border-white/10' 
                                : msg.isSystemReport ? 'bg-green-900/20 border border-green-500/30 text-green-500' 
                                : 'bg-transparent'
                        }`}>
                            {msg.role === 'user' ? (
                                <span className="text-xs">U</span>
                            ) : msg.isSystemReport ? (
                                <span className="text-xs">SYS</span>
                            ) : (
                                <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_10px_white]"></div>
                            )}
                        </div>

                        <div className={`relative max-w-[85%] md:max-w-[80%] ${
                            msg.role === 'user' 
                                ? 'bg-ai-surface/80 border border-white/5 text-white rounded-2xl rounded-tr-sm px-5 py-3 shadow-lg' 
                                : msg.isSystemReport
                                ? 'bg-black border border-green-500/20 text-green-400 rounded-lg px-4 py-3 font-mono text-xs shadow-lg w-full'
                                : 'text-ai-text px-1 py-1 whitespace-pre-wrap leading-relaxed'
                        }`}>
                            {msg.isThinking && (
                                <div className="flex items-center gap-2 mb-2 text-xs text-ai-accent uppercase tracking-wider font-bold opacity-70">
                                    <div className="w-2 h-2 rounded-full bg-ai-accent animate-pulse"></div>
                                    Thinking Process
                                </div>
                            )}
                            
                            {msg.text}

                            {msg.groundingMetadata?.groundingChunks && msg.groundingMetadata.groundingChunks.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-white/10">
                                    <p className="text-[10px] text-ai-subtext uppercase tracking-widest mb-2 font-bold">Sources</p>
                                    <div className="flex flex-wrap gap-2">
                                        {msg.groundingMetadata.groundingChunks.map((chunk, i) => (
                                            chunk.web?.uri && (
                                                <a 
                                                    key={i} 
                                                    href={chunk.web.uri} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-xs text-ai-subtext hover:text-white max-w-[200px] truncate"
                                                >
                                                    <span className="truncate">{chunk.web.title || "Source"}</span>
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                                </a>
                                            )
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {isLoading && (
                     <div className="flex gap-4 animate-fade-in">
                        <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center bg-transparent">
                            <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_10px_white] animate-pulse"></div>
                        </div>
                        <div className="flex items-center gap-1 h-8">
                            <div className="w-1.5 h-1.5 bg-ai-subtext rounded-full animate-bounce"></div>
                            <div className="w-1.5 h-1.5 bg-ai-subtext rounded-full animate-bounce delay-100"></div>
                            <div className="w-1.5 h-1.5 bg-ai-subtext rounded-full animate-bounce delay-200"></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
         </div>

         {/* Floating Input Area (Grok Style) */}
         <div className={`p-4 md:p-6 transition-all duration-700 ease-in-out z-30 ${
             !hasStarted 
             ? 'absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl' 
             : 'sticky bottom-0 w-full max-w-4xl mx-auto'
         }`}>
            <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-ai-accent to-blue-600 rounded-3xl opacity-20 group-hover:opacity-40 transition duration-500 blur"></div>
                
                <div className="relative bg-[#18181B] border border-white/10 rounded-3xl p-2 shadow-2xl flex flex-col transition-all">
                    
                    <textarea 
                        ref={textareaRef}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="What's on your mind ?"
                        rows={1}
                        className="w-full bg-transparent text-white placeholder-ai-subtext/50 px-4 py-3 focus:outline-none resize-none max-h-48 text-base md:text-lg min-h-[56px] flex items-center"
                    />

                    <div className="flex items-center justify-between px-2 pt-2 pb-1">
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => setIsThinkingMode(!isThinkingMode)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                                    isThinkingMode 
                                    ? 'bg-ai-accent/20 text-ai-accent border border-ai-accent/30' 
                                    : 'hover:bg-white/5 text-ai-subtext border border-transparent'
                                }`}
                            >
                                <div className={`w-1.5 h-1.5 rounded-full ${isThinkingMode ? 'bg-ai-accent animate-pulse' : 'bg-current'}`}></div>
                                Deep Think
                            </button>

                            <button 
                                onClick={() => setIsTTSEnabled(!isTTSEnabled)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                                    isTTSEnabled 
                                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                                    : 'hover:bg-white/5 text-ai-subtext border border-transparent'
                                }`}
                            >
                                {isTTSEnabled ? '🔊' : '🔈'} Auto-Read
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                             <button 
                                onMouseDown={startRecording}
                                onMouseUp={stopRecording}
                                onTouchStart={startRecording}
                                onTouchEnd={stopRecording}
                                className={`p-2 rounded-full transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-ai-subtext hover:text-white hover:bg-white/10'}`}
                                title="Hold to Speak"
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                            </button>
                            
                            {/* VOICE MODE BUTTON IN INPUT BOX */}
                            <button 
                                onClick={onSwitchToLive}
                                className="p-2 rounded-full transition-all text-ai-accent hover:bg-ai-accent/20 hover:scale-110 active:scale-95"
                                title="Start Voice Mode"
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 3v18M8 8v8M16 8v8M4 11v2M20 11v2" />
                                </svg>
                            </button>

                            <button 
                                onClick={handleSend}
                                disabled={!inputText.trim() && !isLoading}
                                className={`p-2 rounded-full transition-all duration-300 ${
                                    inputText.trim() 
                                    ? 'bg-ai-accent text-white shadow-lg hover:scale-105 active:scale-95' 
                                    : 'bg-white/10 text-white/20 cursor-not-allowed'
                                }`}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M2 21l21-9L2 3v7l15 2-15 2z"></path></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            {!hasStarted && (
                <div className="text-center mt-6 text-xs text-ai-subtext/40 animate-fade-in delay-200 font-medium">
                    AI can make mistakes. Check important info.
                </div>
            )}
         </div>
      </div>
    </div>
  );
};