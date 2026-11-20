import type { JSX } from 'react';
import { SERVER } from '@/server/config';
import { operatorClient } from './api';
import { OperatorApp } from './OperatorApp';

// One client for the page: its session sits under its own storage key (mk2.operator).
const client = SERVER ? operatorClient(SERVER) : null;

/** The operator panel with this build's server; the entry `main.tsx` loads it on `#/operator`. */
export default function OperatorPanel(): JSX.Element {
  return <OperatorApp client={client} />;
}
