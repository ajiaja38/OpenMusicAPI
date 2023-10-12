require('dotenv').config()

const Hapi = require('@hapi/hapi')
const Jwt = require('@hapi/jwt')
const Inert = require('@hapi/inert')
const { resolve } = require('path')

const ClientError = require('./exceptions/ClientError')

const albums = require('./api/albums')
const AlbumsServices = require('./service/postgres/AlbumsService')
const AlbumsValidator = require('./validator/albums')

const songs = require('./api/songs')
const SongsServices = require('./service/postgres/SongsService')
const SongsValidator = require('./validator/songs')

const users = require('./api/users')
const UsersServices = require('./service/postgres/UsersService')
const UsersValidator = require('./validator/users')

const authentications = require('./api/authentications')
const AuthenticationsServices = require('./service/postgres/AuthenticationsServices')
const TokenManager = require('./tokenize/TokenManager')
const AuthenticationsValidator = require('./validator/authentications')

const playlists = require('./api/playlists')
const PlaylistsServices = require('./service/postgres/PlaylistsService')
const PlaylistsValidator = require('./validator/playlist')

const collaborations = require('./api/collaborations')
const CollaborationsServices = require('./service/postgres/collaborationsServices')
const CollaborationsValidator = require('./validator/collaborations')

const _exports = require('./api/Exports')
const ProducerService = require('./service/rabbitmq/ProducerService')
const ExportsValidator = require('./validator/exports')

const uploads = require('./api/uploads')
const StorageService = require('./service/storage/StorageService')
const UploadsValidator = require('./validator/uploads')

const CacheService = require('./service/redis/ChacheService')

const { app } = require('./utils/config')
const { host, port } = app

const init = async () => {
  const cacheService = new CacheService()
  const albumsServices = new AlbumsServices(cacheService)
  const songsServices = new SongsServices()
  const usersService = new UsersServices()
  const authenticationsService = new AuthenticationsServices()
  const collaborationsServices = new CollaborationsServices()
  const playlistService = new PlaylistsServices(collaborationsServices)
  const storageService = new StorageService(resolve(__dirname, 'api/albums/file/covers'))

  const server = Hapi.server({
    port,
    host,
    routes: {
      cors: {
        origin: ['*']
      }
    }
  })

  await server.register([
    {
      plugin: Jwt
    },
    {
      plugin: Inert
    }
  ])

  server.auth.strategy('openmusicapp_jwt', 'jwt', {
    keys: process.env.ACCESS_TOKEN_KEY,
    verify: {
      aud: false,
      iss: false,
      sub: false,
      maxAgeSec: process.env.ACCESS_TOKEN_AGE
    },
    validate: (artifacts) => ({
      isValid: true,
      credentials: {
        id: artifacts.decoded.payload.id
      }
    })
  })

  await server.register([
    {
      plugin: albums,
      options: {
        service: albumsServices,
        storageService,
        validator: AlbumsValidator,
        uploadsValidator: UploadsValidator
      }
    },
    {
      plugin: songs,
      options: {
        service: songsServices,
        validator: SongsValidator
      }
    },
    {
      plugin: users,
      options: {
        service: usersService,
        validator: UsersValidator
      }
    },
    {
      plugin: authentications,
      options: {
        authenticationsService,
        usersService,
        tokenManager: TokenManager,
        validator: AuthenticationsValidator
      }
    },
    {
      plugin: playlists,
      options: {
        service: playlistService,
        validator: PlaylistsValidator,
        songService: songsServices
      }
    },
    {
      plugin: collaborations,
      options: {
        collaborationsService: collaborationsServices,
        playlistService,
        userService: usersService,
        validator: CollaborationsValidator
      }
    },
    {
      plugin: _exports,
      options: {
        producerService: ProducerService,
        playlistService,
        validator: ExportsValidator
      }
    },
    {
      plugin: uploads,
      options: {
        service: storageService,
        validator: UploadsValidator
      }
    }
  ])

  server.ext('onPreResponse', (request, h) => {
    // mendapatkan konteks response dari request
    const { response } = request
    if (response instanceof Error) {
      // penanganan client error secara internal.
      if (response instanceof ClientError) {
        const newResponse = h.response({
          status: 'fail',
          message: response.message
        })
        newResponse.code(response.statusCode)
        return newResponse
      }
      // mempertahankan penanganan client error oleh hapi secara native, seperti 404, etc.
      if (!response.isServer) {
        return h.continue
      }
      // penanganan server error sesuai kebutuhan
      const newResponse = h.response({
        status: 'error',
        message: 'terjadi kegagalan pada server kami'
      })
      newResponse.code(500)
      return newResponse
    }
    // jika bukan error, lanjutkan dengan response sebelumnya (tanpa terintervensi)
    return h.continue
  })

  await server.start()
  console.log(`Server berjalan pada ${server.info.uri}`)
}

init()
