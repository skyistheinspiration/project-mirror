
import asyncio
import socket
import time
from datetime import datetime, timezone

import psutil
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api/live-monitor", tags=["Live Monitor"])

_previous_bytes = None
_previous_time = None

_internet_state = None
_failed_checks = 0
_successful_checks = 0
_last_alert_times = {}

ALERT_COOLDOWN = 60

# Public connectivity endpoints.
# This performs basic TCP reachability checks only.
CONNECTIVITY_TARGETS = [
    ("1.1.1.1", 443),
    ("8.8.8.8", 443),
]


def check_internet_connectivity():
    """
    Checks internet connectivity by attempting TCP connections
    to known public endpoints.

    Returns:
        connected: bool
        latency_ms: float | None
        endpoint: str | None
    """

    for host, port in CONNECTIVITY_TARGETS:
        start = time.monotonic()

        try:
            with socket.create_connection(
                (host, port),
                timeout=2
            ):
                elapsed = (time.monotonic() - start) * 1000

                return {
                    "connected": True,
                    "latency_ms": round(elapsed, 2),
                    "endpoint": f"{host}:{port}",
                }

        except (OSError, socket.timeout):
            continue

    return {
        "connected": False,
        "latency_ms": None,
        "endpoint": None,
    }


def get_network_snapshot(internet):
    global _previous_bytes, _previous_time

    now = time.monotonic()
    counters = psutil.net_io_counters()

    current_bytes = {
        "sent": counters.bytes_sent,
        "received": counters.bytes_recv,
    }

    sent_rate = 0.0
    received_rate = 0.0

    if _previous_bytes and _previous_time:
        elapsed = max(now - _previous_time, 0.001)

        sent_rate = max(
            0,
            current_bytes["sent"] - _previous_bytes["sent"]
        ) / elapsed

        received_rate = max(
            0,
            current_bytes["received"] - _previous_bytes["received"]
        ) / elapsed

    _previous_bytes = current_bytes
    _previous_time = now

    interfaces = []

    addresses = psutil.net_if_addrs()
    stats = psutil.net_if_stats()

    for name, address_list in addresses.items():
        interface_info = stats.get(name)

        if not interface_info or not interface_info.isup:
            continue

        ipv4 = None

        for address in address_list:
            if address.family == socket.AF_INET:
                ipv4 = address.address
                break

        if ipv4 and not ipv4.startswith("127."):
            interfaces.append({
                "name": name,
                "ipv4": ipv4,
                "speed_mbps": interface_info.speed,
                "is_up": interface_info.isup,
            })

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hostname": socket.gethostname(),

        "cpu_percent": psutil.cpu_percent(interval=None),
        "memory_percent": psutil.virtual_memory().percent,

        "internet": internet,

        "network": {
            "bytes_sent": counters.bytes_sent,
            "bytes_received": counters.bytes_recv,

            "packets_sent": counters.packets_sent,
            "packets_received": counters.packets_recv,

            "send_rate_bytes_sec": round(sent_rate, 2),
            "receive_rate_bytes_sec": round(received_rate, 2),
        },

        "interfaces": interfaces,
    }


def should_emit_alert(rule, cooldown=ALERT_COOLDOWN):
    now = time.monotonic()
    last = _last_alert_times.get(rule, 0)

    if now - last >= cooldown:
        _last_alert_times[rule] = now
        return True

    return False


def create_events(snapshot):
    global _internet_state
    global _failed_checks
    global _successful_checks

    events = []

    cpu = snapshot["cpu_percent"]
    memory = snapshot["memory_percent"]
    network = snapshot["network"]
    internet = snapshot["internet"]

    # CPU alert
    if cpu >= 90 and should_emit_alert("CPU_USAGE"):
        events.append({
            "severity": "HIGH",
            "type": "CPU_USAGE",
            "message": f"High CPU usage detected: {cpu}%"
        })

    # Memory alert
    if memory >= 90 and should_emit_alert("MEMORY_USAGE"):
        events.append({
            "severity": "HIGH",
            "type": "MEMORY_USAGE",
            "message": f"High memory usage detected: {memory}%"
        })

    # Incoming traffic alert
    if (
        network["receive_rate_bytes_sec"] >= 5_000_000
        and should_emit_alert("INCOMING_TRAFFIC")
    ):
        events.append({
            "severity": "MEDIUM",
            "type": "TRAFFIC_SPIKE",
            "message": "High incoming network traffic observed"
        })

    # Outgoing traffic alert
    if (
        network["send_rate_bytes_sec"] >= 5_000_000
        and should_emit_alert("OUTGOING_TRAFFIC")
    ):
        events.append({
            "severity": "MEDIUM",
            "type": "TRAFFIC_SPIKE",
            "message": "High outgoing network traffic observed"
        })

    # Internet connectivity state
    if internet["connected"]:
        _successful_checks += 1
        _failed_checks = 0
    else:
        _failed_checks += 1
        _successful_checks = 0

    # Initial connection state
    if _internet_state is None:
        _internet_state = internet["connected"]

    # Internet loss
    if (
        not internet["connected"]
        and _failed_checks >= 2
        and _internet_state is True
    ):
        _internet_state = False

        events.append({
            "severity": "HIGH",
            "type": "INTERNET_DISCONNECTED",
            "message": "Internet connectivity has been lost after consecutive failed checks."
        })

    # Internet restored
    if (
        internet["connected"]
        and _successful_checks >= 1
        and _internet_state is False
    ):
        _internet_state = True

        events.append({
            "severity": "LOW",
            "type": "INTERNET_RESTORED",
            "message": "Internet connectivity has been restored."
        })

    return events


@router.websocket("/ws")
async def live_monitor_websocket(websocket: WebSocket):
    global _previous_bytes
    global _previous_time
    global _internet_state
    global _failed_checks
    global _successful_checks

    await websocket.accept()

    # Reset per-connection state
    _previous_bytes = None
    _previous_time = None
    _internet_state = None
    _failed_checks = 0
    _successful_checks = 0

    try:
        while True:

            # Perform the connectivity check without blocking
            # the asynchronous WebSocket loop.
            internet = await asyncio.to_thread(
                check_internet_connectivity
            )

            snapshot = get_network_snapshot(internet)

            payload = {
                "type": "LIVE_SNAPSHOT",
                "data": snapshot,
                "events": create_events(snapshot),
            }

            await websocket.send_json(payload)

            await asyncio.sleep(2)

    except WebSocketDisconnect:
        pass

    except Exception as exc:
        try:
            await websocket.send_json({
                "type": "ERROR",
                "message": str(exc)
            })
        except Exception:
            pass
