/**
 * Device discovery client
 * Listen to the `discover` event with <Discover>.on('discover', callback)
 */

import { analysePacket } from "./util/messageProtocol";
import { EventEmitter } from "node:events";
import dgram from "node:dgram";
import type DiscoveryType from "./types/DiscoveryType";

export default class Discovery extends EventEmitter {
	socket: dgram.Socket;

	/**
	 * Scan for devices
	 *
	 * @param timeout Duration (in milliseconds) to discover for, or indefinitely if empty
	 * @returns
	 */
	async start(
		timeout: number | null | { timeout?: number; filter?: (d: DiscoveryType) => boolean; signal?: AbortSignal } = null,
	) {
		const opts =
			typeof timeout === "number" || timeout === null
				? { timeout }
				: { timeout: timeout?.timeout ?? null, filter: timeout?.filter, signal: timeout?.signal };

		return new Promise<void>((resolve) => {
			this.stop();
			this.setup(opts.filter);

			if (opts.signal?.aborted) {
				this.stop();
				return resolve();
			}

			const onAbort = () => {
				this.stop();
				resolve();
			};
			opts.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts.timeout !== null && typeof opts.timeout === "number") {
				setTimeout(() => {
					opts.signal?.removeEventListener("abort", onAbort);
					this.stop();
					resolve();
				}, opts.timeout);
			}
		});
	}

	/**
	 * Shut down discovery client
	 */
	stop() {
		if (this.socket !== undefined) {
			this.socket.close();
			this.socket = undefined;
		}
	}

	/**
	 * Setup routine
	 */
	private setup(filter?: (d: DiscoveryType) => boolean) {
		// Listen to broadcast on port 47809
		const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
		socket.bind(47809, "0.0.0.0");
		socket.on("listening", function () {
			this.setBroadcast(true);
		});

		socket.on("message", (packet, rinfo) => {
			const [code, data] = analysePacket(packet, true);
			if (!code) return;

			// Split data by null byte
			const fragments = [];
			for (let payload = data.slice(20), cur = 0, f: Buffer; cur < payload.length; cur += f.length + 1) {
				f = payload.slice(cur, payload.indexOf("\x00", cur));
				fragments.push(f.toString("utf8"));
			}

			// eslint-disable-next-line
			const [nameA, _, serial, nameB] = fragments;

			if (!serial) return;

			// nameA: Model number for device image identification
			// nameB: ???
			const device: DiscoveryType = {
				name: nameA,
				serial,
				ip: rinfo.address,
				port: rinfo.port,
				timestamp: new Date(),
			};

			if (filter && !filter(device)) return;
			this.emit("discover", device);
		});

		this.socket = socket;
	}
}
