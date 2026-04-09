import json
import os
import signal
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

BROKER_HOST = os.environ.get("MQTT_BROKER_HOST", "127.0.0.1")
# Default matches docker-compose host map (18883:1883); use 1883 if you talk to a bare broker on localhost.
BROKER_PORT = int(os.environ.get("MQTT_BROKER_PORT", "18883"))
# Comma-separated topics, e.g. export MQTT_VALIDATE_TOPICS="VIB/dataset,sensors/#"
_raw_topics = (os.environ.get("MQTT_VALIDATE_TOPICS") or "").strip()
TOPICS = [(p.strip(), 0) for p in _raw_topics.split(",") if p.strip()]
INACTIVITY_TIMEOUT_SECONDS = int(os.environ.get("MQTT_VALIDATE_INACTIVITY_SEC", "120"))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def minute_bucket(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M")


class TopicStats:
    def __init__(self, topic_name: str):
        self.topic_name = topic_name
        self.first_message_ts = None
        self.last_message_ts = None
        self.total_messages = 0

        # minute -> site -> count
        self.per_minute_per_site = defaultdict(lambda: defaultdict(int))

        # minute -> device -> count
        self.per_minute_per_device = defaultdict(lambda: defaultdict(int))

        # minute -> site -> device -> count
        self.per_minute_per_site_device = defaultdict(
            lambda: defaultdict(lambda: defaultdict(int))
        )

        # total site counts
        self.total_by_site = defaultdict(int)

        # total device counts
        self.total_by_device = defaultdict(int)

        # total by site+device
        self.total_by_site_device = defaultdict(lambda: defaultdict(int))

    def update(self, site: str, device: str, ts: datetime) -> None:
        if self.first_message_ts is None:
            self.first_message_ts = ts
        self.last_message_ts = ts
        self.total_messages += 1

        bucket = minute_bucket(ts)

        self.per_minute_per_site[bucket][site] += 1
        self.per_minute_per_device[bucket][device] += 1
        self.per_minute_per_site_device[bucket][site][device] += 1

        self.total_by_site[site] += 1
        self.total_by_device[device] += 1
        self.total_by_site_device[site][device] += 1


class SubscriberReport:
    def __init__(self):
        self.topic_stats: dict[str, TopicStats] = {}
        self.global_first_ts = None
        self.global_last_ts = None
        self.last_received_monotonic = None
        self.should_exit = False

    def mark_message(self, topic: str, site: str, device: str) -> None:
        now = utc_now()
        self.last_received_monotonic = time.monotonic()

        if self.global_first_ts is None:
            self.global_first_ts = now
        self.global_last_ts = now

        if topic not in self.topic_stats:
            self.topic_stats[topic] = TopicStats(topic)

        self.topic_stats[topic].update(site, device, now)

    def inactivity_exceeded(self) -> bool:
        if self.last_received_monotonic is None:
            return False
        return (time.monotonic() - self.last_received_monotonic) > INACTIVITY_TIMEOUT_SECONDS

    def print_report(self) -> None:
        print("\n" + "=" * 100)
        print("MQTT SUBSCRIBER CONSOLIDATED REPORT")
        print("=" * 100)
        print(f"Broker               : {BROKER_HOST}:{BROKER_PORT}")
        print(f"Global first message : {self._fmt_ts(self.global_first_ts)}")
        print(f"Global last message  : {self._fmt_ts(self.global_last_ts)}")
        print()

        for topic_name in sorted(self.topic_stats.keys()):
            stats = self.topic_stats[topic_name]

            print("-" * 100)
            print(f"Topic                : {topic_name}")
            print(f"First message        : {self._fmt_ts(stats.first_message_ts)}")
            print(f"Last message         : {self._fmt_ts(stats.last_message_ts)}")
            print(f"Total messages       : {stats.total_messages}")
            print()

            print("Total by site:")
            if stats.total_by_site:
                for site, count in sorted(stats.total_by_site.items()):
                    print(f"  {site}: {count}")
            else:
                print("  No messages")
            print()

            print("Total by device:")
            if stats.total_by_device:
                for device, count in sorted(stats.total_by_device.items()):
                    print(f"  {device}: {count}")
            else:
                print("  No messages")
            print()

            print("Total by site and device:")
            if stats.total_by_site_device:
                for site in sorted(stats.total_by_site_device.keys()):
                    print(f"  {site}:")
                    for device, count in sorted(stats.total_by_site_device[site].items()):
                        print(f"    {device}: {count}")
            else:
                print("  No messages")
            print()

            print("Per-minute counts by site:")
            if stats.per_minute_per_site:
                for bucket in sorted(stats.per_minute_per_site.keys()):
                    site_counts = stats.per_minute_per_site[bucket]
                    line = ", ".join(f"{site}={count}" for site, count in sorted(site_counts.items()))
                    print(f"  {bucket} UTC -> {line}")
            else:
                print("  No messages")
            print()

            print("Per-minute counts by device:")
            if stats.per_minute_per_device:
                for bucket in sorted(stats.per_minute_per_device.keys()):
                    device_counts = stats.per_minute_per_device[bucket]
                    line = ", ".join(f"{device}={count}" for device, count in sorted(device_counts.items()))
                    print(f"  {bucket} UTC -> {line}")
            else:
                print("  No messages")
            print()

            print("Per-minute counts by site and device:")
            if stats.per_minute_per_site_device:
                for bucket in sorted(stats.per_minute_per_site_device.keys()):
                    print(f"  {bucket} UTC")
                    for site in sorted(stats.per_minute_per_site_device[bucket].keys()):
                        device_counts = stats.per_minute_per_site_device[bucket][site]
                        line = ", ".join(
                            f"{device}={count}" for device, count in sorted(device_counts.items())
                        )
                        print(f"    {site} -> {line}")
            else:
                print("  No messages")
            print()

        print("=" * 100)

    @staticmethod
    def _fmt_ts(ts: datetime) -> str:
        if ts is None:
            return "N/A"
        return ts.isoformat()


report = SubscriberReport()


def extract_site(payload: dict) -> str:
    for key in ("site", "site_id", "siteId"):
        if key in payload and payload[key] not in (None, ""):
            return str(payload[key])
    return "unknown"


def extract_device(payload: dict) -> str:
    for key in ("device", "device_id", "deviceId", "id"):
        if key in payload and payload[key] not in (None, ""):
            return str(payload[key])
    return "unknown"


def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"Connected to MQTT broker at {BROKER_HOST}:{BROKER_PORT}")
        for topic, qos in TOPICS:
            client.subscribe(topic, qos=qos)
            print(f"Subscribed to {topic}")
    else:
        print(f"Failed to connect, rc={rc}")
        report.should_exit = True


def on_message(client, userdata, msg):
    payload_text = msg.payload.decode("utf-8", errors="replace")
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError:
        payload = {}

    site = extract_site(payload)
    device = extract_device(payload)

    report.mark_message(msg.topic, site, device)

    print(
        f"[{utc_now().isoformat()}] "
        f"topic={msg.topic} site={site} device={device} payload={payload_text}"
    )


def on_disconnect(client, userdata, disconnect_flags, reason_code, properties=None):
    print(f"Disconnected from broker. reason_code={reason_code}")


def handle_signal(signum, frame):
    print(f"\nReceived signal {signum}, exiting...")
    report.should_exit = True


def main():
    if not TOPICS:
        print(
            "Set MQTT_VALIDATE_TOPICS to a comma-separated list of topics, e.g.\n"
            '  export MQTT_VALIDATE_TOPICS="VIB/dataset,sensors/#"\n'
            "Optional: MQTT_BROKER_HOST, MQTT_BROKER_PORT, MQTT_VALIDATE_INACTIVITY_SEC",
            file=sys.stderr,
        )
        sys.exit(1)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    client = mqtt.Client(client_id="vib-subscriber", protocol=mqtt.MQTTv5)
    client.on_connect = on_connect
    client.on_message = on_message
    client.on_disconnect = on_disconnect

    client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    client.loop_start()

    try:
        while not report.should_exit:
            time.sleep(1)

            if report.inactivity_exceeded():
                print(
                    f"\nNo message received for more than "
                    f"{INACTIVITY_TIMEOUT_SECONDS} seconds. Exiting..."
                )
                break
    finally:
        client.loop_stop()
        client.disconnect()
        report.print_report()


if __name__ == "__main__":
    main()
