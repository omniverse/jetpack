const info = require('./info');
const globals = require('./globals');
const s3 = require('s3');

function s3Client(bucket, project_path, access_key, secret_key, globals) {
  var err = false;

  if (typeof bucket === undefined) {
    info.error("S3_BUCKET not defined in .env file.");
    err = true;
  }
  if (typeof project_path === undefined) {
    info.error("S3_PROJECT_PATH not defined in .env file.");
    err = true;
  }
  if (typeof access_key === undefined) {
    info.error("S3_ACCESS_KEY_ID not defined in .env file.");
    err = true;
  }
  if (typeof secret_key === undefined) {
    info.error("S3_SECRET_KEY not defined in .env file.");
    err = true;
  }

  if (err) {
    throw new Error('Could not connect to S3');
  }

  var pp = process.env.S3_PATH;
  var awsRegion = (pp.split('.'))[0].replace('https://s3-','');

  var client = s3.createClient({
    maxAsyncS3: 20,     // this is the default
    s3RetryCount: 3,    // this is the default
    s3RetryDelay: 1000, // this is the default
    multipartUploadThreshold: 20971520, // this is the default (20 MB)
    multipartUploadSize: 15728640, // this is the default (15 MB)
    s3Options: {
      Bucket: bucket,
      accessKeyId: access_key,
      secretAccessKey: secret_key,
      region: awsRegion

  // any other options are passed to new AWS.S3()
      // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
    }
  });

  function getJSONFile(file, onLoad, onError) {
    info.log("fetching " + file + " from : " + bucket + '/' + s3Path());

    var s3Params = {
      Bucket: bucket,
      Key: s3Path() + "/" + file
    };

    var downloader = client.downloadBuffer(s3Params);
    downloader.on('error', function(err) {
      if (typeof onError === 'function') {
        onError(err);
      } else {
        info.error("unable to download: " + bucket + '/' + s3Path() + '/' + file);
        info.error(err.stack);
        info.log('If you are releasing a new site bundle, use the jetpack create command to create the initial file structure.');
      }
    });
    downloader.on('progress', function() {
      info.progress(/*".", downloader.progressAmount, downloader.progressTotal*/);
    });
    downloader.on('end', function(buffer) {
      var data = JSON.parse(buffer.toString('ascii'));
      onLoad(data);
    });
  }

  function moveFiles(localDir, targetPath, onComplete, onError) {
    info.log('uploading local dir ' + localDir);
    var params = {
      "localDir": localDir,
      deleteRemoved: true,
      s3Params: {
        Bucket: bucket,
        Prefix: s3Path() + targetPath,
        ACL: 'public-read'
      }
    };

    var up = client.uploadDir(params);
    up.on('error', function(err) {
      info.error("unable to upload:");
      info.error(err.stack);
      if (typeof onError === 'function') {
        onError(err);
      }
    });
    up.on('progress', function() {
      info.progress(/*".", up.progressAmount, up.progressTotal*/);
    });
    up.on('end', function() {
      info.log('done');

      var publicPath = s3.getPublicUrlHttp(bucket, s3Path() + targetPath);
      if (typeof onComplete === 'function') {
        onComplete(publicPath);
      }
    });
  }

  function uploadFile(localPath, filename, onComplete) {

    var params = {
      localFile: localPath, //env.workingDir + '/dist/' + site + '/release.json',
      s3Params : {
        Bucket: bucket,
        Key: s3Path() + '/' + filename,
        ACL: 'public-read'
      }
    };

    var uploader = client.uploadFile(params);
    uploader.on('error', function(err) {
      console.error("unable to upload:", err.stack);
    });
    uploader.on('progress', function() {
      info.progress(/*".", up.progressAmount, up.progressTotal*/);
    });
    uploader.on('end', function() {
      console.log("done uploading");
      if (typeof onComplete === 'function') {
        var publicPath = s3.getPublicUrlHttp(bucket, s3Path() + '/' + filename);
        if (typeof onComplete === 'function') {
          onComplete(publicPath);
        }
      }
    });
  }

  function s3Path() {
    return (project_path ? project_path + '/' : '') + globals.site();
  }

  return {
    "getJSONFile" : getJSONFile,
    "uploadFile" : uploadFile,
    "moveFiles" : moveFiles,
    "remotePath" : s3Path,
  };
}

s3Client.default = function () {
  var client = s3Client(process.env.S3_BUCKET,
    process.env.S3_PROJECT_PATH,
    process.env.S3_ACCESS_KEY_ID,
    process.env.S3_SECRET_KEY,
    globals);

  return client;
}

module.exports = s3Client;
