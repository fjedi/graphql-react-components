import { MouseEvent } from 'react';

export type LoggerProps = { level?: 'info' | 'warn' | 'error'; [k: string]: unknown };

export type LoggerEvent = Event | MouseEvent;

export default function logger(message: string | Error, props?: LoggerProps | Error | Event): void {
  let level;
  if (props instanceof Error) {
    level = 'error';
  } else if (props instanceof Event || props instanceof MouseEvent) {
    level = 'info';
  } else {
    level = props?.level ?? 'info';
  }
  if (
    process.env.NEXT_PUBLIC_RUNTIME_ENV !== 'production' && // support public nextjs env-vars
    process.env.RUNTIME_ENV !== 'production'
  ) {
    if (!message) {
      // eslint-disable-next-line no-console
      console.error('Logger has received event without message', props);
      return;
    }
    if (message instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(message, props);
      return;
    }
    // eslint-disable-next-line no-console
    console[level](message, props);
  }
}