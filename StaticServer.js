function StaticServer(server) {
    const lockedPathsPrefixes = ["/EDFS", "/receive-message"];
    const fs = require("fs");
    const path = require("path");

    function sendFiles(req, res, next) {
        const prefix = "/directory-summary/";
        requestValidation(req, "GET", prefix, function (notOurResponsibility, targetPath) {
            if (notOurResponsibility) {
                return next();
            }
            targetPath = targetPath.replace(prefix, "");
            serverTarget(targetPath);
        });

        function serverTarget(targetPath) {
            console.log("Serving summary for dir:", targetPath);
            fs.stat(targetPath, function (err, stats) {
                if (err) {
                    res.statusCode = 404;
                    res.end();
                    return;
                }
                if (!stats.isDirectory()) {
                    res.statusCode = 403;
                    res.end();
                    return;
                }

                function send() {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', "application/json");
                    //let's clean some empty objects
                    for (let prop in summary) {
                        if (Object.keys(summary[prop]).length === 0) {
                            delete summary[prop];
                        }
                    }

                    res.write(JSON.stringify(summary));
                    res.end();
                }

                let summary = {};
                let directories = {};

                function extractContent(currentPath) {
                    directories[currentPath] = -1;
                    let summaryId = currentPath.replace(targetPath, "");
                    summaryId = summaryId.split(path.sep).join("/");
                    if (summaryId === "") {
                        summaryId = "/";
                    }
                    //summaryId = path.basename(summaryId);
                    summary[summaryId] = {};

                    fs.readdir(currentPath, function (err, files) {
                        if (err) {
                            return markAsFinish(currentPath);
                        }
                        directories[currentPath] = files.length;
                        //directory empty test
                        if (files.length === 0) {
                            return markAsFinish(currentPath);
                        } else {
                            for (let i = 0; i < files.length; i++) {
                                let file = files[i];
                                const fileName = path.join(currentPath, file);
                                if (fs.statSync(fileName).isDirectory()) {
                                    extractContent(fileName);
                                } else {
                                    let fileContent = fs.readFileSync(fileName);
                                    summary[summaryId][file] = fileContent.toString();
                                }
                                directories[currentPath]--;
                            }
                            return markAsFinish(currentPath);
                        }
                    });
                }

                function markAsFinish(targetPath) {
                    if (directories [targetPath] > 0) {
                        return;
                    }
                    delete directories [targetPath];
                    const dirsLeftToProcess = Object.keys(directories);
                    //if there are no other directories left to process
                    if (dirsLeftToProcess.length === 0) {
                        send();
                    }
                }

                extractContent(targetPath);
            })
        }

    }
    function sendFile(res, file) {
        let stream = fs.createReadStream(file);
        const mimes = require("./MimeType");
        let ext = path.extname(file);
        if (ext !== "") {
            ext = ext.replace(".", "");
            res.setHeader('Content-Type', mimes.getMimeTypeFromExtension(ext).name);
        } else {
            res.setHeader('Content-Type', "application/octet-stream");
        }
        res.statusCode = 200;
        stream.pipe(res);
        stream.on('finish', () => {
            res.end();
        });
    }

    function requestValidation(req, method, urlPrefix, callback) {
        if (typeof urlPrefix === "function") {
            callback = urlPrefix;
            urlPrefix = undefined;
        }
        if (req.method !== method) {
            //we resolve only GET requests
            return callback(true);
        }

        if (typeof urlPrefix === "undefined") {
            for (let i = 0; i < lockedPathsPrefixes.length; i++) {
                let reservedPath = lockedPathsPrefixes[i];
                //if we find a url that starts with a reserved prefix is not our duty ro resolve
                if (req.url.indexOf(reservedPath) === 0) {
                    return callback(true);
                }
            }
        } else {
            if (req.url.indexOf(urlPrefix) !== 0) {
                return callback(true);
            }
        }

        const rootFolder = server.rootFolder;
        const path = require("path");
        let requestedUrl = req.url;
        if (urlPrefix) {
            requestedUrl = requestedUrl.replace(urlPrefix, "");
        }
        let targetPath = path.resolve(path.join(rootFolder, requestedUrl));
        //if we detect tricks that tries to make us go above our rootFolder to don't resolve it!!!!
        if (targetPath.indexOf(rootFolder) !== 0) {
            return callback(true);
        }
        callback(false, targetPath);
    }

    function redirect(req, res, next) {
        requestValidation(req, "GET", function (notOurResponsibility, targetPath) {
            if (notOurResponsibility) {
                return next();
            }
            //from now on we mean to resolve the url
            fs.stat(targetPath, function (err, stats) {
                if (err) {
                    res.statusCode = 404;
                    res.end();
                    return;
                }
                if (stats.isDirectory()) {
                    let url = req.url;
                    if (url[url.length - 1] !== "/") {
                        res.writeHead(302, {
                            'Location': url + "/"
                        });
                        res.end();
                        return;
                    }
                    const defaultFileName = "index.html";
                    const defaultPath = path.join(targetPath, defaultFileName);
                    fs.stat(defaultPath, function (err) {
                        if (err) {
                            res.statusCode = 403;
                            res.end();
                            return;
                        }
                        return sendFile(res, defaultPath);
                    });
                } else {
                    return sendFile(res, targetPath);
                }
            });
        });
    }

    server.use("*", sendFiles);
    server.use("*", redirect);
}

module.exports = StaticServer;