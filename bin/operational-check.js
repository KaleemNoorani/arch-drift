#!/usr/bin/env node
import { main } from '../src/operational/cli.js';

process.exitCode = await main(process.argv.slice(2));
