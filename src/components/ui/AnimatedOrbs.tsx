'use client';

export function AnimatedOrbs() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
      <div className="absolute top-[-20%] left-[10%] w-[500px] h-[500px] rounded-full bg-purple-600/15 blur-[120px] animate-pulse-glow" />
      <div
        className="absolute bottom-[-10%] right-[5%] w-[600px] h-[600px] rounded-full bg-blue-600/15 blur-[120px] animate-pulse-glow"
        style={{ animationDelay: '1.5s' }}
      />
      <div
        className="absolute top-[40%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-pink-600/10 blur-[100px] animate-pulse-glow"
        style={{ animationDelay: '3s' }}
      />
    </div>
  );
}
