# PROTOTYPE, throwaway. Plays the user's terminal: runs the wrapper in a pty and
# follows a script of steps from argv. Raw output -> /tmp/mclaude-proto/tty.raw,
# timestamped events -> /tmp/mclaude-proto/drive.log.
import os, pty, sys, time, select, re, termios, struct, fcntl, signal, json
P = "/tmp/mclaude-proto"
ANSI = re.compile(rb'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[=>]|\r')
t0 = time.time()
raw = open(f"{P}/tty.raw", "wb"); dl = open(f"{P}/drive.log", "a")
def log(s): dl.write(f"{time.time()-t0:8.3f} {s}\n"); dl.flush()
script = [l.strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith("#")]
wrapper_args = sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(os.path.expanduser("~/.bun/bin/bun"), ["bun", os.path.join(os.path.dirname(os.path.abspath(__file__)), "mclaude-proto.ts")] + wrapper_args)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
buf = b""
def pump(timeout):
    global buf
    r, _, _ = select.select([fd], [], [], timeout)
    if r:
        try: d = os.read(fd, 65536)
        except OSError: return False
        if not d: return False
        raw.write(d); raw.flush(); buf += d
    return True
def wait_for(pat, timeout):
    global buf
    start = time.time(); rx = re.compile(pat.encode())
    while time.time() - start < timeout:
        if rx.search(re.sub(rb"\s+", b"", ANSI.sub(b"", buf))): log(f"seen {pat!r} after {time.time()-start:.2f}s"); return True
        if not pump(0.05): break
    log(f"TIMEOUT waiting {pat!r} ({timeout}s)"); return False
def termios_flags():
    a = termios.tcgetattr(fd)
    return {"ICANON": bool(a[3] & termios.ICANON), "ECHO": bool(a[3] & termios.ECHO), "ISIG": bool(a[3] & termios.ISIG), "OPOST": bool(a[1] & termios.OPOST)}
for step in script:
    cmd, _, arg = step.partition(" ")
    if cmd == "wait": pat, _, to = arg.rpartition(" "); wait_for(pat.replace(" ", ""), float(to))
    elif cmd == "send": os.write(fd, arg.encode()); log(f"sent {arg!r}")
    elif cmd == "enter": os.write(fd, b"\r"); log("sent enter")
    elif cmd == "sleep": end = time.time() + float(arg);
    elif cmd == "trigger": open(f"{P}/limit", "w").write(arg); log(f"trigger {arg}")
    elif cmd == "untrigger":
        try: os.remove(f"{P}/limit")
        except FileNotFoundError: pass
        log("untrigger")
    elif cmd == "termios": log(f"termios {json.dumps(termios_flags())}")
    elif cmd == "mark": buf = b""; log(f"mark {arg}")
    elif cmd == "screen": log("screen tail: " + ANSI.sub(b"", buf)[-int(arg or 1500):].decode("utf8", "replace").replace("\n", "\n         | "))
    elif cmd == "quit": os.kill(pid, signal.SIGKILL); log("killed wrapper")
    if cmd == "sleep":
        while time.time() < end: pump(0.05)
while pump(2): pass
log("done")
