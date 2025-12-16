import React, { useEffect, useRef, useState } from 'react';
import { connectLiveSession } from '../services/gemini';
import { createPcmBlob, decodeBase64, decodeAudioData, INPUT_SAMPLE_RATE } from '../services/audioUtils';
import { LiveServerMessage } from '@google/genai';

interface LiveModeProps {
  onBack: () => void;
}

const LiveMode: React.FC<LiveModeProps> = ({ onBack }) => {
  const [status, setStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'>('DISCONNECTED');
  const [volume, setVolume] = useState(0); 
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<string>('Fenrir'); 
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const disconnect = () => {
     if (sessionRef.current) {
        sessionRef.current = null;
     }
     activeSourcesRef.current.forEach(source => {
         try { source.stop(); } catch(e) {}
     });
     activeSourcesRef.current.clear();

     if (audioStreamRef.current) {
         audioStreamRef.current.getTracks().forEach(t => t.stop());
     }
     if (inputAudioContextRef.current) {
         inputAudioContextRef.current.close();
     }
     if (outputAudioContextRef.current) {
         outputAudioContextRef.current.close();
     }
     setStatus('DISCONNECTED');
  };

  const startLiveSession = async (voiceName: string) => {
    setStatus('CONNECTING');
    setErrorMsg('');
    setSelectedVoice(voiceName);

    try {
        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: INPUT_SAMPLE_RATE});
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStreamRef.current = stream;

        const sessionPromise = connectLiveSession(
            () => {
                setStatus('CONNECTED');
                setupAudioInput(stream, sessionPromise);
            },
            (msg) => handleServerMessage(msg),
            () => {
                setStatus('DISCONNECTED');
                console.log('Session Closed');
            },
            (err) => {
                setStatus('ERROR');
                setErrorMsg('Connection failed: ' + err.message);
            },
            voiceName // Pass selected voice directly
        );
        sessionRef.current = sessionPromise;

    } catch (e: any) {
        console.error(e);
        setStatus('ERROR');
        setErrorMsg(e.message || "Microphone access required.");
    }
  };

  const setupAudioInput = (stream: MediaStream, sessionPromise: Promise<any>) => {
    if (!inputAudioContextRef.current) return;

    const source = inputAudioContextRef.current.createMediaStreamSource(stream);
    // Lower buffer size (2048) for lower latency and faster interrupt detection
    const processor = inputAudioContextRef.current.createScriptProcessor(2048, 1, 1);
    scriptProcessorRef.current = processor;

    processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        let sum = 0;
        for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
        setVolume(Math.sqrt(sum / inputData.length));

        const pcmBlob = createPcmBlob(inputData);
        sessionPromise.then(session => {
             session.sendRealtimeInput({ media: pcmBlob });
        });
    };

    source.connect(processor);
    processor.connect(inputAudioContextRef.current.destination);
  };

  const handleServerMessage = async (message: LiveServerMessage) => {
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    
    if (base64Audio && outputAudioContextRef.current) {
        const ctx = outputAudioContextRef.current;
        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
        
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx, 24000);
        
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        
        source.onended = () => {
            activeSourcesRef.current.delete(source);
        };
        activeSourcesRef.current.add(source);

        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
    }

    if (message.serverContent?.interrupted) {
         // Instant Interrupt Handling: Stop all audio immediately
         activeSourcesRef.current.forEach(source => {
             try { source.stop(); } catch(e) {}
         });
         activeSourcesRef.current.clear();
         
         // Reset play cursor to now
         if(outputAudioContextRef.current) {
            nextStartTimeRef.current = outputAudioContextRef.current.currentTime;
         }
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-ai-bg text-ai-text relative font-sans overflow-hidden">
        
        {/* Background Effects */}
        <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[-20%] left-[-20%] w-[800px] h-[800px] bg-purple-900/10 rounded-full blur-[120px] animate-pulse-slow"></div>
            <div className="absolute bottom-[-20%] right-[-20%] w-[800px] h-[800px] bg-blue-900/10 rounded-full blur-[120px] animate-float"></div>
        </div>

        <button 
            onClick={onBack}
            className="absolute top-6 left-6 px-5 py-2.5 glass-panel text-ai-subtext rounded-full hover:bg-white/10 hover:text-white transition-all z-20 text-sm font-medium flex items-center gap-2"
        >
            <span className="text-lg">←</span> Back
        </button>

        <div className="relative flex items-center justify-center w-full max-w-lg z-10 px-6">
            
            {status === 'DISCONNECTED' && (
                <div className="flex flex-col items-center gap-8 animate-fade-in w-full">
                     <h2 className="text-3xl font-bold text-white tracking-tight">Select Voice Profile</h2>
                     <div className="grid grid-cols-2 gap-6 w-full">
                        <button
                            onClick={() => startLiveSession('Fenrir')}
                            className="group relative flex flex-col items-center justify-center gap-4 p-8 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-ai-accent/50 transition-all duration-300"
                        >
                             <div className="w-16 h-16 rounded-full bg-ai-surface flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-lg border border-white/5">
                                👨
                             </div>
                             <span className="text-lg font-medium text-white">Male</span>
                             <span className="text-xs text-ai-subtext uppercase tracking-wider">Fenrir</span>
                        </button>

                        <button
                            onClick={() => startLiveSession('Kore')}
                            className="group relative flex flex-col items-center justify-center gap-4 p-8 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-ai-accent/50 transition-all duration-300"
                        >
                             <div className="w-16 h-16 rounded-full bg-ai-surface flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-lg border border-white/5">
                                👩
                             </div>
                             <span className="text-lg font-medium text-white">Female</span>
                             <span className="text-xs text-ai-subtext uppercase tracking-wider">Kore</span>
                        </button>
                     </div>
                </div>
            )}

            {(status === 'CONNECTING' || status === 'CONNECTED') && (
                <div className="relative flex items-center justify-center w-96 h-96">
                    {status === 'CONNECTED' && (
                        <>
                            {/* Heartbeat Ripples */}
                            <div 
                                className="absolute inset-0 rounded-full border border-ai-accent/30 opacity-40 transition-all duration-75"
                                style={{ transform: `scale(${1 + volume * 5})` }}
                            />
                            <div 
                                className="absolute inset-0 rounded-full bg-ai-accent/5 opacity-20 transition-all duration-150"
                                style={{ transform: `scale(${1 + volume * 8})` }}
                            />
                        </>
                    )}
                    
                    {/* Main Heartbeat Core */}
                    <div className={`z-10 w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 shadow-[0_0_50px_rgba(0,0,0,0.5)] ${
                        status === 'CONNECTED' 
                        ? 'bg-black border-2 border-ai-accent animate-heartbeat shadow-[0_0_30px_rgba(139,92,246,0.4)]' 
                        : 'bg-black border border-white/10 animate-pulse'
                    }`}>
                        <div className={`w-4 h-4 bg-white rounded-full shadow-[0_0_15px_white] ${status === 'CONNECTING' ? 'opacity-50' : ''}`}></div>
                    </div>
                </div>
            )}

            {status === 'ERROR' && (
                <div className="text-center space-y-4">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20 text-red-500 text-3xl">
                        ⚠️
                    </div>
                    <p className="text-red-400 text-sm bg-red-950/30 py-3 px-6 rounded-lg border border-red-500/20 backdrop-blur-sm">
                        {errorMsg}
                    </p>
                    <button onClick={() => setStatus('DISCONNECTED')} className="text-sm text-white underline hover:text-ai-accent">
                        Try Again
                    </button>
                </div>
            )}
        </div>
        
        {/* Footer Info */}
        {(status === 'CONNECTED' || status === 'CONNECTING') && (
             <div className="mt-12 text-center z-10 animate-fade-in">
                <p className="text-ai-subtext/60 text-sm">
                    Listening...
                </p>
            </div>
        )}

    </div>
  );
};

export default LiveMode;