import { Argument, Command, Option } from 'commander'
import os from 'os'
import fs from 'fs'
import { clusterApiUrl, Connection, Keypair } from '@solana/web3.js'
import log from 'loglevel'

import { fatalError } from './lib/error'
import { loadJson, saveJson } from './lib/fs'

const DEFAULT_CONFIG_DIR = `${os.homedir()}/.platyplex`
const DEFAULT_CONFIG_PATH = `${DEFAULT_CONFIG_DIR}/config`

const DEFAULT_CONFIG = {
  env: 'mainnet-beta',
  logLevel: 'info'
}

export interface Config {
  rpcUrl: string
  env: string
  keypair: string
  logLevel?: 'info' | 'debug' | 'trace'
}

export interface ConfigContext {
  configRaw: Config
  connection: Connection
  keypair: Keypair
}

if (!fs.existsSync(DEFAULT_CONFIG_DIR)) {
  fs.mkdirSync(DEFAULT_CONFIG_DIR)
  saveJson(DEFAULT_CONFIG_PATH, DEFAULT_CONFIG)
}

export const registerPrefix = (command: Command) => {
  return command
    .option('--config <path>', 'Path to the platyplex config', DEFAULT_CONFIG_PATH)
    .option('--keypair <path>', 'Path to keypair for transactions. Overrides config')
    .option('--rpc-url <url>', 'Custom RPC server to use for transactions. Overrides config')
    .addOption(new Option('--log-level <level>', 'Logging level to stdout. Overrides config').choices(['trace', 'debug', 'info']))
    .addOption(
      new Option('--env <env>', 'Solana environment. Overrides config. Is ignored if rpc-url is specified.')
        .choices(['devnet', 'testnet', 'mainnet-beta'])
        .default('mainnet-beta')
    )
}

export const registerCommand = (command: Command) => {
  const configCommand = command.command('config')
  configCommand
    .option('--config <path>', 'Path to the platyplex config')
    .addArgument(new Argument('[mode]', 'list, get or set').choices(['get', 'set', 'list']).default('list'))
    .addArgument(new Argument('[name]', 'Config name'))
    .addArgument(new Argument('[value]', 'Config value'))
    .addArgument(new Argument('[subvalue]', 'Config subvalue'))
    .addHelpText('after', `
  
Available config names/values/subvalues:
  env: mainnet-beta, devnet, testnet
  keypair: <path/to/keypair>
  rpcUrl:
    mainnet-beta: <url>
    devnet: <url>
    testnet: <url>

Example config set:

  platyplex config set rpcUrl mainnet-beta https://solana-api.projectserum.com
`)
    .action((mode, name, value, subvalue, options) => {
      const { config } = options
      const configPath = config || DEFAULT_CONFIG_PATH
      const configRaw = loadJson(configPath)
      log.setLevel(configRaw.logLevel || DEFAULT_CONFIG.logLevel)
      switch (mode) {
        case 'get':
          if (!name) {
            fatalError('Name of config must be specified')
          }
          const val = configRaw[name]
          if (val && typeof val === 'object') {
            log.info(`${name}:`)
            Object.keys(val).forEach((subvalue) => {
              log.info(`  ${subvalue}: ${val[subvalue]}`)
            })
          } else {
            log.info(`${name}: ${val}`)
          }

          break
        case 'set':
          if (!name || !value) {
            fatalError('Name and value of must be specified')
            // TODO only allow valid config values
          }
          if (subvalue) {
            log.info(`Old ${name} ${configRaw[value]}: ${configRaw[name]?.[value]}`)
            log.info(`New ${name} ${configRaw[value]}: ${subvalue}`)
            configRaw[name] = configRaw[name] || {}
            configRaw[name][value] = subvalue
          } else {
            log.info(`Old ${name}: ${configRaw[name]}`)
            log.info(`New ${name}: ${value}`)
            configRaw[name] = value
          }
          saveJson(configPath, configRaw)
          break
        case 'list':
        default:
          Object.keys(configRaw).forEach((k) => {
            const val = configRaw[k]
            if (val && typeof val === 'object') {
              log.info(`${k}:`)
              Object.keys(val).forEach((subvalue) => {
                log.info(`  ${subvalue}: ${val[subvalue]}`)
              })
            } else {
              log.info(`${k}: ${val}`)
            }
          })
      }

    })
}



export const loadConfig = (options: any): ConfigContext => {
  const configPath = options.config || DEFAULT_CONFIG_PATH

  let configRaw
  try {
    configRaw = loadJson(configPath)
  } catch (e) {
    fatalError(`Error reading config at ${configPath}`)
  }

  const keypairPath = options.keypair || configRaw.keypair
  if (!keypairPath) {
    fatalError('No keypair found. See https://docs.solana.com/wallet-guide/file-system-wallet for information on how to generate a keypair')
  }

  const env = options.env || configRaw.env
  if (!env) {
    fatalError(`env must be defined in the config`)
  }

  const rpcUrl: string = options.rpcUrl || configRaw.rpcUrl?.[env] || clusterApiUrl(env)
  const keypair = Keypair.fromSecretKey(new Uint8Array(loadJson(keypairPath)))
  const connection = new Connection(rpcUrl)
  const logLevel = options.logLevel || configRaw.logLevel || 'info'
  log.setLevel(logLevel)

  const ctx: ConfigContext = {
    configRaw: {
      rpcUrl,
      env,
      keypair: keypairPath,
    },
    keypair,
    connection
  }

  return ctx
}