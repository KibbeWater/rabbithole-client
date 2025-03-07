import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTTS } from './tts';

type MessageType = 'user' | 'rabbit' | 'system';
type MessageDataType = 'text' | 'audio' | 'image';
type Message = {
	id: string;
	type: MessageType;
	dataType: MessageDataType;
	data: string;
};

export function useRabbitHole({
	accountKey,
	imei,
	onRegister,
	url,
}: {
	accountKey?: string;
	imei?: string;
	onRegister?: (imei: string, accountKey: string, data: string) => void;
	url: string;
}) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [logs, setLogs] = useState<string[]>([]);
	const [authenticated, setAuthenticated] = useState<boolean>(false);
	const [canAuthenticate, setCanAuthenticate] = useState<boolean>(false);

	const WS = useRef<WebSocket | null>(null);

	const { speak } = useTTS();

	// ID is a hash based on the current time
	const addMessage = (data: string, type: MessageType, dataType: MessageDataType) =>
		setMessages((prevMessages) => [
			{
				id: Math.random().toString(36).substring(7),
				type,
				data,
				dataType,
			},
			...prevMessages,
		]);

	useEffect(() => {
		if (!url || url === '') return;
		console.log('Building new websocket');

		const urlObj = new URL(url);
		if (imei) urlObj.searchParams.append('deviceId', imei);

		const newWS = new WebSocket(urlObj);
		WS.current = newWS;

		newWS.addEventListener('open', () => {
			setLogs((prevLogs) => [...prevLogs, 'Connected to Rabbithole']);
			addMessage('Connected to Rabbithole', 'system', 'text');
			setCanAuthenticate(true);
			console.log('Connected to Rabbithole');
		});

		newWS.addEventListener('message', (event) => {
			const data = JSON.parse(event.data);

			switch (data.type) {
				case 'logon':
					if (data.data !== 'success') return setLogs((prevLogs) => [...prevLogs, 'Authentication failed']);

					setAuthenticated(true);
					setCanAuthenticate(false);
					setLogs((prevLogs) => [...prevLogs, 'Authenticated successfully']);
					addMessage('Authenticated successfully', 'system', 'text');

					break;
				case 'message':
					setLogs((prevLogs) => [...prevLogs, `${data.data}`]);
					addMessage(data.data, 'rabbit', 'text');
					break;
				case 'ptt':
					addMessage(data.data, 'user', 'audio');
					break;
				case 'audio':
					const audioB64 = data.data.audio;
					speak(audioB64);
					break;
				case 'register':
					const { imei, accountKey } = data.data;
					const responseData = JSON.stringify(data.data);
					onRegister?.(imei, accountKey, responseData);
					setLogs((prevLogs) => [...prevLogs, `Registered with data: ${responseData}`]);
					break;
				case 'long':
					const images = data.data.images as string[];
					addMessage(images.join('\n'), 'rabbit', 'image');
				case 'meeting':
					const isActive = data.active;
					if (isActive) {
						addMessage('Meeting started', 'system', 'text');
					}
				default:
					console.log('Unknown message type', data.type, data.data);
					break;
			}
		});

		newWS.addEventListener('close', () => {
			setLogs((prevLogs) => [...prevLogs, 'Disconnected from Rabbithole']);
			addMessage('Disconnected from Rabbithole', 'system', 'text');
			setCanAuthenticate(false);
			setAuthenticated(false);
		});

		newWS.addEventListener('error', (error) => {
			setLogs((prevLogs) => [...prevLogs, `Error: ${JSON.stringify(error)}`]);
			addMessage(`Error: ${JSON.stringify(error)}`, 'system', 'text');
		});

		return () => {
			newWS.close();
			setCanAuthenticate(false);
			setAuthenticated(false);
		};
	}, [speak, onRegister, url, imei]);

	useEffect(() => {
		if (!canAuthenticate || authenticated || !WS.current) return;

		if (accountKey === '' || imei === '') {
			setLogs((prevLogs) => [...prevLogs, 'Account key or IMEI not provided']);
			return;
		}

		const payload = JSON.stringify({ type: 'logon', data: { imei, accountKey } });
		setLogs((prevLogs) => [
			...prevLogs,
			`Authenticating with payload: ${JSON.stringify({
				type: 'logon',
				data: { imei: '*********', accountKey: '*******************' },
			})}`,
		]);
		addMessage('Authenticating', 'system', 'text');
		WS.current.send(payload);
	}, [accountKey, imei, WS, canAuthenticate, authenticated]);

	const sendMessage = useCallback(
		(message: string) => {
			if (!authenticated || !WS.current) return;
			const payload = JSON.stringify({ type: 'message', data: message });
			setLogs((prevLogs) => [...prevLogs, `Sending message: ${payload}`]);
			addMessage(message, 'user', 'text');
			WS.current.send(payload);
		},
		[authenticated, WS]
	);

	const sendPTT = useCallback(
		(ptt: boolean, image: string) => {
			if (!authenticated || !WS.current) return;
			const payload = JSON.stringify({ type: 'ptt', data: { active: ptt, image } });
			setLogs((prevLogs) => [...prevLogs, `Sending PTT with status ${ptt} ${image ? 'with an image' : 'without image'}`]);
			/* addMessage(`${ptt ? 'Started' : 'Stopped'} PTT`, 'system', 'text'); */
			if (image) addMessage(image, 'user', 'image');
			WS.current.send(payload);
		},
		[authenticated, WS]
	);

	const sendAudio = useCallback(
		(audio: Blob) => {
			if (!authenticated) return;
			// We need to send the a b64 encoded string of the audio
			const reader = new FileReader();
			reader.onload = (event) => {
				const result = event.target?.result;
				if (!result || !WS.current) return;

				if (typeof result === 'string' && result.startsWith('data:audio/wav')) {
					const payload = JSON.stringify({ type: 'audio', data: result.toString() });
					/* setLogs((prevLogs) => [...prevLogs, `Sending audio`]); */
					addMessage('Sending audio', 'system', 'text');
					WS.current.send(payload);
				}
			};
			reader.readAsDataURL(audio);
		},
		[authenticated, WS]
	);

	const register = useCallback(
		(qrcodeData: string) => {
			if (!canAuthenticate || authenticated || !WS.current) return;
			const payload = JSON.stringify({ type: 'register', data: qrcodeData });
			setLogs((prevLogs) => [...prevLogs, `Registering: ${payload}`]);
			addMessage('Registering', 'system', 'text');
			WS.current.send(payload);
		},
		[WS, canAuthenticate, authenticated]
	);

	const sendRaw = useCallback(
		(data: string) => {
			if (!WS.current) return;
			WS.current.send(JSON.stringify({ type: 'raw', data }));
		},
		[WS]
	);

	const stopMeeting = useCallback(() => {
		if (!authenticated || !WS.current) return;
		WS.current.send(JSON.stringify({ type: 'meeting', data: false }));
	}, [authenticated, WS]);

	return { logs, messages, canAuthenticate, authenticated, sendMessage, sendPTT, sendRaw, sendAudio, register, stopMeeting };
}
