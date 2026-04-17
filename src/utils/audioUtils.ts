// Module-level singleton AudioContext — avoids creating (and leaking) a new
// OS audio handle on every TTS playback call. The context is lazily created
// on first use and reused thereafter.
let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioContextClass({ sampleRate: 24000 });
  }
  return sharedAudioCtx;
}

export async function playPCM(base64Data: string): Promise<void> {
  try {
    const audioCtx = getAudioContext();

    // Resume if suspended (browser autoplay policy)
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    // Decode: base64 → Int16 PCM → Float32
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const pcm16 = new Int16Array(bytes.buffer);

    const audioBuffer = audioCtx.createBuffer(1, pcm16.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) {
      channelData[i] = pcm16[i] / 32768.0;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start();

    return new Promise<void>(resolve => {
      source.onended = () => resolve();
    });
  } catch (error) {
    console.error("Error playing audio:", error);
  }
}

/** Call once on app unmount to release the OS audio handle. */
export function closeAudioContext(): void {
  if (sharedAudioCtx && sharedAudioCtx.state !== "closed") {
    sharedAudioCtx.close();
    sharedAudioCtx = null;
  }
}
