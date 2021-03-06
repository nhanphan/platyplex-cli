import { Argument, Command, Option, program } from 'commander'
import fs from 'fs'

import {
  Metadata,
  MetadataData,
  MetadataDataData,
  UpdateMetadata,
} from '@metaplex-foundation/mpl-token-metadata'
import log from 'loglevel'

import { registerPrefix, loadConfig } from './config'
import { fatalError } from './lib/error'
import { Connection, ParsedAccountData, PublicKey } from '@solana/web3.js'
import { MetadataJson, programs, utils, actions } from '@metaplex/js'
import { Wallet } from '@project-serum/anchor'
import { isUrl, sleep } from './lib/util'
import { validateMetadata } from './metadata'
import { findTargets, loadJson, saveJson, TargetType } from './lib/fs'

interface MintResult {
  target?: string
  txId?: string
  mint?: string
  metadata?: string
  error?: string
  name?: string
}

interface MintRetryCache {
  [index: string]: MintResult
}

const mintResultToString = (result: MintResult): string => {
  if (result.error) {
    return `[error]  ${result.error} ${result.target} `
  } else {
    return `[success] ${result.name}
  target: ${result.target}
  mint: ${result.mint}
  metadata: ${result.metadata}
  txId: ${result.txId}
`
  }
}

export const registerCommand = (program: Command) => {
  registerPrefix(program.command('mint'))
    .addArgument(new Argument('[targets...]', 'filepath(s), URI(s), or folder to json metadata'))
    .option('--retry-cache <cache>', 'use cache to retry in an idempotent manner')
    .option('--no-retry', 'do not retry on failure')
    .option('--json-list <file>', 'a JSON list of files/URIs to mint')
    // .option('--immutable', 'mint immutable NFTs. Default is mutable') // TODO
    .action(async (targets, options) => {
      const config = loadConfig(options)
      const { immutable, jsonList, retry, retryCache } = options
      if (!targets.length && !jsonList) {
        fatalError('At least one metadata JSON or JSON list must be speficied as an argument')
      }

      if (jsonList) {
        try {
          const list = loadJson(jsonList)
          if (!Array.isArray(list)) {
            fatalError(`${jsonList} is not an array`)
          }
          for (const l of list) {
            if (typeof l != 'string') {
              fatalError(`JSON list expected a string but found ${l}`)
            }
            targets.push(l)
          }
        } catch (e) {
          fatalError(`Could not read json list ${jsonList}`)
        }
      }

      let cache: MintRetryCache = {}
      if (retryCache && fs.existsSync(retryCache)) {
        cache = loadJson(retryCache)
      }

      const metas: {
        path: string,
        type: TargetType
        meta?: MetadataJson
      }[] = findTargets(targets)

      let errors = 0

      for (let i = 0; i < metas.length; i++) {
        const meta = metas[i]

        if (!cache[i]?.txId) {
          const result: MintResult = {
            target: meta.path
          }
          if (meta.type === TargetType.File) {
            fatalError('file unimplemented')
          } else {

            try {
              meta.meta = await utils.metadata.lookup(meta.path)
              if (!validateMetadata(meta.meta)) {
                log.warn(`Invalid metadata at ${meta.path}`)
                meta.meta = undefined
                result.error = 'Invalid metadata'
              }
            } catch (e) {
              log.warn(`Failed to fetch metadata at ${meta.path}`)
              result.error = 'Failed to fetch metadata'
            }
          }

          if (meta.meta) {
            let success = false
            let retries = retry ? 5 : 1
            while (!success && retries > 0) {
              try {
                const response = await actions.mintNFT({
                  connection: config.connection,
                  uri: meta.path,
                  wallet: new Wallet(config.keypair)
                })
                result.name = meta.meta.name
                result.mint = response.mint.toBase58()
                result.metadata = response.metadata.toBase58()
                result.txId = response.txId
                success = true
              } catch (e) {
                log.warn(`Failed to mint ${meta.path}`)
                retries--
                if (retries) {
                  log.warn('Retrying in 2s...')
                  await sleep(2000)
                }
              }
            }
            if (!success) {
              result.error = `Failed to mint`
              errors++
            }
            cache[i] = result
            log.info(mintResultToString(result))
            if (retryCache) {
              saveJson(retryCache, cache)
            }
          }
        }
      }
      log.info(`Completed with ${errors} errors`)
    })
}
