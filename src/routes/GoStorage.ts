import {Router, Request, Response, NextFunction} from 'express';
import * as gs from '@google-cloud/storage';
import {createWriteStream, createReadStream, pathExists, ensureDirSync, readFile} from 'fs-extra';
import {parse, join} from 'path';
import * as sharp from 'sharp';
import * as winston from 'winston';

export class GoStorage {
  router: Router
  private connection;
  private bucket;
  private root = "/path/to/folder/";
  private config = {
    root: "/path/to/folder/",
    projectId: "projectId",
    keyFilename: "keyFilename",
    bucket: "bucketName",
  };
  private notFound = join(this.config.root, "image-not-found.jpg");
  /**
   * Fetching from Google Storage options
   */
  private fetch = {
    width: 800
  };

  /**
   * Initialize the GoStorage
   */
  constructor() {
    this.router = Router();
    this.init();
    this.connect();

    // -->Logger: configure
    winston.configure({
      transports: [
        new (winston.transports.File)({ filename: join(this.config.root, 'error.log') })
      ]
    });
  }

  /**
   * Connect to GoogleCloudStorage and prepare listings
   */
  private connect(): void {
    this.connection = gs({
      projectId: this.config.projectId,
      keyFilename: this.config.keyFilename
    });


    // Get my bucket 
    this.bucket = this.connection.bucket(this.config.bucket);
  }

  /**
   *  Read file from bucket
   */
  public getFileFromStorage(path: string) {
    return new Promise((res, rej) => {

      // todo: get the XML data from storage as well to see what format it is
      // todo: set file with path to what it is

      // -->Resize: declare
      const resize = sharp().resize(this.fetch.width).jpeg();

      // -->Parse: the path
      let p = parse(path);
      // -->Ensure: local path
      ensureDirSync(join("cache", p.dir));
      // Streams are also supported for reading and writing files.
      var remoteReadStream = this.bucket.file(path).createReadStream();
      var localWriteStream = createWriteStream(join("cache", p.dir, "receipt"));
      var writePipe = remoteReadStream.pipe(resize).pipe(localWriteStream);
      writePipe
        .on('finish', function () {
            res(true)
        })
        .on('error', function() {
            winston.error('PIPE_ERROR: Cannot write from remoteStream to localStream');
            res(false);
        })
    })
  }

 /**
  * Transform response header in photo data
  * @param response 
  * @param path 
  * @param type 
  */
 respondPic(response: Response, path: string, query = {}, type = 'jpeg') {
    return new Promise((res, rej) => {

      sharp(path)
        .resize(+query['width'] || null, +query['height'] || null)
        .jpeg()
        .toBuffer()
        .then((err, data) => {

              var img = new Buffer(err, 'base64');
              response
                .status(200)
                .writeHead(200, {
                  'Content-Type': 'image/jpeg', 'Content-Length': img.length
                });

                response.end(img);
        })
        .catch(err => {
            winston.error('SHPAR_ERROR: Cannot process image in respondPic', err);
            console.log(err)
        })
    })
  }

  /**
   * Take each handler, and attach to one of the Express.Router's
   * endpoints.
   */
  init() {
    this.router.get('/:folder/:subfolder/:receipt', (req: Request, res: Response, next: NextFunction) => {
        const params = req.params;

        // -->Set: link
        const path = join(this.config.root, "cache", params.folder, params.subfolder, (params.receipt) ? params.receipt : "receipt"),
              storagePath = join(params.folder, params.subfolder, "receipt");

        // -->Check: link exists
        pathExists(path)
          .then(exists => {
              if (exists) 
                  this.respondPic(res, path, req.query);
              else{
                  // -->Get: file from storage
                  this.getFileFromStorage(storagePath)
                    .then(ok => {
                        this.respondPic(res, path, req.query)
                    })
                    .catch(err => {
                        console.error(err)
                        this.respondPic(res, this.notFound);
                        winston.error('FETCH_ERROR: Was not in cache and when I fetched, it failed', err);                        
                    })
              }
          })
          .catch(err => {
              winston.error('PATH_READ_ERROR: Cannot read from path', err);
              console.error(err)
              this.respondPic(res, this.notFound);
          })
    });
  }
}

// Create the GoStorage, and export its configured Express.Router
const goStorage = new GoStorage();
goStorage.init();

export default goStorage.router;
