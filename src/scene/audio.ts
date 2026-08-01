/**
 * Procedural Web Audio API sound generator for the pit fire.
 * Synthesizes ambient low flame rumble, mid hiss, and dynamic wood crackles & pops.
 * Automatically unlocks on user interaction and smoothly fades volume
 * based on camera view (pit, orbit, desk/screen).
 */

export class FireAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private hissGain: GainNode | null = null;
  private crackleGain: GainNode | null = null;
  private initialized = false;
  private isMuted = false;
  private targetVolume = 0; // Starts silent (page boots in orbit view)
  private currentVolume = 0;

  private nextPopTime = 0;
  private popIntervalMin = 0.05;
  private popIntervalMax = 0.22;
  private stokeBoost = 0;

  constructor() {
    const unlock = () => {
      this.init();
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock);
  }

  private init() {
    if (this.initialized) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Create 2-second loopable noise buffer
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      // 1. Low Flame Rumble (lowpass filter ~180Hz)
      const lowFilter = this.ctx.createBiquadFilter();
      lowFilter.type = "lowpass";
      lowFilter.frequency.setValueAtTime(180, this.ctx.currentTime);

      this.rumbleGain = this.ctx.createGain();
      this.rumbleGain.gain.setValueAtTime(0.25, this.ctx.currentTime);

      noiseSource.connect(lowFilter);
      lowFilter.connect(this.rumbleGain);
      this.rumbleGain.connect(this.masterGain);

      // 2. Mid Flame Hiss (bandpass filter ~1000Hz)
      const midFilter = this.ctx.createBiquadFilter();
      midFilter.type = "bandpass";
      midFilter.frequency.setValueAtTime(1000, this.ctx.currentTime);
      midFilter.Q.setValueAtTime(1.2, this.ctx.currentTime);

      this.hissGain = this.ctx.createGain();
      this.hissGain.gain.setValueAtTime(0.05, this.ctx.currentTime);

      noiseSource.connect(midFilter);
      midFilter.connect(this.hissGain);
      this.hissGain.connect(this.masterGain);

      // 3. Crackle Pops Bus
      this.crackleGain = this.ctx.createGain();
      this.crackleGain.gain.setValueAtTime(0.45, this.ctx.currentTime);
      this.crackleGain.connect(this.masterGain);

      noiseSource.start();
      this.initialized = true;
    } catch {
      /* AudioContext unavailable or blocked */
    }
  }

  /** Trigger an individual crackle/pop sound burst */
  private triggerPop(now: number) {
    if (!this.ctx || !this.crackleGain || this.isMuted || this.currentVolume <= 0.01) return;

    // Short noise burst for wood snap
    const popDuration = 0.003 + Math.random() * 0.015;
    const bufferSize = Math.floor(this.ctx.sampleRate * popDuration);
    const popBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = popBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }

    const popSource = this.ctx.createBufferSource();
    popSource.buffer = popBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = Math.random() > 0.4 ? "highpass" : "bandpass";
    filter.frequency.setValueAtTime(2000 + Math.random() * 3500, now);
    filter.Q.setValueAtTime(2 + Math.random() * 4, now);

    const gain = this.ctx.createGain();
    const vol = (0.2 + Math.random() * 0.6) * (1 + this.stokeBoost * 0.8);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + popDuration);

    popSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.crackleGain);

    popSource.start(now);
  }

  public setView(view: "orbit" | "desk" | "screen" | "pit" | "pad") {
    switch (view) {
      case "pit":
        this.targetVolume = 0.5; // Only active when inside the pit
        break;
      case "orbit":
      case "desk":
      case "screen":
      case "pad":
      default:
        this.targetVolume = 0; // Completely silent outside the pit
        break;
    }
  }

  public stoke() {
    this.stokeBoost = 1.0;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  public get muted(): boolean {
    return this.isMuted;
  }

  public update(dt: number) {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    if (this.ctx.state === "suspended") return;

    // Smoothly transition volume
    const target = this.isMuted ? 0 : this.targetVolume;
    this.currentVolume += (target - this.currentVolume) * Math.min(dt * 3, 1);

    const now = this.ctx.currentTime;
    this.masterGain.gain.setValueAtTime(Math.max(0, this.currentVolume * 0.25), now);

    // Boost rumble and hiss slightly during stoke
    if (this.rumbleGain && this.hissGain) {
      this.rumbleGain.gain.setValueAtTime(0.35 + this.stokeBoost * 0.3, now);
      this.hissGain.gain.setValueAtTime(0.08 + this.stokeBoost * 0.1, now);
    }

    // Decay stoke boost
    if (this.stokeBoost > 0) {
      this.stokeBoost = Math.max(0, this.stokeBoost - dt * 0.45);
    }

    // Generate crackle pops at dynamic intervals
    if (now >= this.nextPopTime) {
      this.triggerPop(now);
      const interval =
        (this.popIntervalMin + Math.random() * (this.popIntervalMax - this.popIntervalMin)) /
        (1 + this.stokeBoost * 1.5);
      this.nextPopTime = now + interval;
    }
  }
}
