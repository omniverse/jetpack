const globals = require('../lib/helpers/globals');
const info = require('../lib/helpers/info');
const s3Client = require('../lib/helpers/s3Client');
const Manifest = require('../lib/helpers/manifest');
const rp = require('request-promise-native');
const fs = require('fs');

const masterClient = s3Client(process.env.S3_BUCKET,
  process.env.S3_MASTER_PATH,
  process.env.S3_ACCESS_KEY_ID,
  process.env.S3_SECRET_KEY,
  globals);

function buildMasterBundle () {
  if (process.env.S3_MASTER_PATH) {
    info.label('**Master bundle build**');
    const localManifest = new Manifest();
    const masterManifest = new Manifest();

    const MASTER_FILE = 'master_min.js';
    const localMasterFile = globals.workingDir() + '/dist/' + globals.site() + '/' + MASTER_FILE;
    const fetchMasterInfo = new Promise((resolve, reject) => {
      masterClient.getJSONFile('release.json', resolve, (err) => {
        info.log(err);
        info.log('Master Manifest not found. Starting from scratch.');
        resolve(null);
      });
    });

    const fetchLocalInfo = new Promise((resolve/*, reject*/) => {
      info.log('fetching: local release.json');
      localManifest.readLocalFile(() => resolve(localManifest));
    });

    fetchMasterInfo
      .then((json) => {
        if (json) {
          masterManifest.load(json);
          if (json.master) {
            masterManifest.appendMaster(json.master, json.master.components);
          }
        }
      })
      .then(() => {
        return fetchLocalInfo;
      })
      .then(() => {
        const m = masterManifest.data();
        let masterComponents = (m.master && m.master.components) || [];
        const newComponents = [];

        //We need a clean version of the local manifest without the master info.
        const projectManifest = (new Manifest()).load(localManifest.data());

        let hasLocalProject = false;
        const projectBundlePath = projectManifest.data().url;

        for (let b = 0; b < masterComponents.length; b++) {
          if (masterComponents[b].url === projectBundlePath) {
            if (!hasLocalProject) {
              newComponents.push(projectManifest.data());
              hasLocalProject = true;
            }
          } else {
            newComponents.push(masterComponents[b]);
          }
        }
        if (!hasLocalProject) {
          newComponents.push(projectManifest.data());
        }

        const remoteBundles = newComponents.map((bund) => {
          if (bund.url === projectBundlePath) {
            return 'local';
          }
          return bund.url + bund.version + '/' + bund.bundle;
        });

        const chunkPromises = remoteBundles.map((location) => {
          if (location === 'local') {
            info.log('fetching local manifest');
            return new Promise(function (resolve, reject) {
              fs.readFile(globals.workingDir() + '/dist/' + globals.site() + '/' + localManifest.data().bundle, 'utf8', function (err, data) {
                if (err) {
                  reject(err);
                } else {
                  resolve(data);
                }
              });
            });
          }
          info.log('fetching component: ' + location);
          return rp(location);
        });

        Promise.all(chunkPromises)
          .then((chunks) => {
            let c = 0;
            fs.unlink(localMasterFile, () => {
              const snippetpath = globals.workingDir() + '/node_modules/jetpack/lib/devRedirectSnippet_min.js';
              fs.readFile(snippetpath, 'utf8', function (err, data) {
                if (err) {
                  info.log(snippetpath + ' not found.');
                  process.exit();
                } else if (data) {
                  const header = data + '!(function(){if(jpcheck(\'' + process.env.S3_PATH + '\')){console.log(\'jetpack dev redirect\');return;} else {';
                  const footer = '}})();';
                  fs.appendFileSync(localMasterFile, header, 'utf8');
                  chunks.forEach((chunk) => {
                    fs.appendFileSync(localMasterFile, '/*BUNDLE ' + remoteBundles[c] + ' */\n(function(){try {return ', 'utf8');
                    fs.appendFileSync(localMasterFile, chunk, 'utf8');
                    fs.appendFileSync(localMasterFile, ';} catch (ex) {\'console\' in window && console.log(ex);}})();', 'utf8');
                    c++;
                  });
                  fs.appendFileSync(localMasterFile, footer, 'utf8');
                }
              });
            });
          })
          .then(() => {
            console.log('writing master and component manifest');
            localManifest.appendMaster(MASTER_FILE, newComponents);
            localManifest.write();
            console.log(localManifest.stringify());
            buildMasterManifest(false);
          })
          .catch((err) => {
            info.error(err);
            process.exit();
          });
      })
      .catch((err) => {
        info.error('Master build error');
        info.error(err);
        process.exit();
      });
  } else {
    info.log('No S3_MASTER_PATH defined. No bundle merge performed.');
  }
}

function buildMasterManifest (doUpload) {
  if (process.env.S3_MASTER_PATH) {
    const newMasterManifest = new Manifest('release-master.json');

    const fetchLocalInfo = new Promise((resolve/*, reject*/) => {
      info.log('fetching: local release.json');
      newMasterManifest.readLocalFile(() => resolve(newMasterManifest), true);
    });
    fetchLocalInfo
      .then((localManifest) => {
        try {
          const d = localManifest.data();
          info.log(localManifest.stringify());
          d.bundle = d.master.bundle;
        } catch (ex) {
          info.error(ex);
          throw new Error('Invalid manifest. Possibly no components found. So we cannoot rollback the master manifest.');
        }
      })
      .then(() => {
        newMasterManifest.write(true);
        if (doUpload) {
          info.label('**Master Release**');
          masterClient.uploadFile(globals.dist() + 'release-master.json', 'release.json', function (location) {
            info.log('Created master release at ' + location);
          });
        }
      })
      .catch((err) => {
        info.error('Master release error');
        info.error(err);
        process.exit();
      });
  } else {
    info.log('No S3_MASTER_PATH defined. No bundle merge performed.');
  }
}

module.exports = {
  buildMasterBundle,
  buildMasterManifest: () => { buildMasterManifest(false); },
  releaseMasterManifest: () => { buildMasterManifest(true); }
};
