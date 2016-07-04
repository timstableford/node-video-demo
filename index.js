var ffmpeg = require("fluent-ffmpeg");
var os = require("os");
var path = require("path");
var fs = require('fs');
var child_process = require('child_process');
var express = require('express');
var app = express();

var chunkSize = 30; // seconds

var args = ['-threads', '6', '-c:v', 'libvpx', '-c:a', 'libvorbis', '-b:v', '1M', '-crf', '18', '-f', 'webm'];
var tmpdir = os.tmpdir() + '/' + 'node-video';

var currentlyProcessingFiles = [];
function isCurrentlyProcessing(file) {
  for(var i = 0; i < currentlyProcessingFiles.length; i++) {
    if (currentlyProcessingFiles[i].file == file) {
      return true;
    }
  }
  return false;
}
function addProcessingListener(file, listener) {
  addProcessing(file);
  for(var i = 0; i < currentlyProcessingFiles.length; i++) {
    if (currentlyProcessingFiles[i].file == file) {
      currentlyProcessingFiles[i].listeners.push(listener);
      return;
    }
  }
}
function getProcessingListeners(file) {
  for(var i = 0; i < currentlyProcessingFiles.length; i++) {
    if (currentlyProcessingFiles[i].file == file) {
      return currentlyProcessingFiles[i].listeners;
    }
  }
  return [];
}
function removeProcessingFile(file) {
  var i = 0;
  var found = false;
  for(i = 0; i < currentlyProcessingFiles.length; i++) {
    if (currentlyProcessingFiles[i].file == file) {
      found = true;
      break;
    }
  }
  if (found) {
    currentlyProcessingFiles.splice(i, 1);
  }
}
function addProcessing(file) {
  if (!isCurrentlyProcessing(file)) {
    obj = {};
    obj.file = file;
    obj.listeners = [];
    currentlyProcessingFiles.push(obj);
  }
}

var getPart = function(input, startTime, callback) {
  fs.stat(tmpdir, function(err, stats) {
    if (err) {
      fs.mkdir(tmpdir);
    }
  });
  var outputFile = tmpdir + '/' + path.basename(input) + '_' + startTime + '-' + (startTime + chunkSize) + '.webm'
  var remuxFile = outputFile + "-remuxed.webm";
  if (isCurrentlyProcessing(remuxFile)) {
    addProcessingListener(remuxFile, callback);
    return;
  }
  fs.stat(remuxFile, function(err, stats) {
    if (!err && stats.isFile()) {
      callback(remuxFile, startTime, chunkSize);
    } else {
      addProcessing(remuxFile);
      // Setup ffmpeg for transcoding with specified times.
      var ffm = ffmpeg(input).outputOptions(args).seekInput(startTime).duration(chunkSize);
      ffm.on('error', function(err, stdout, stderr) {
        console.log(err.message); //this will likely return "code=1" not really useful
        console.log("stdout:\n" + stdout);
        console.log("stderr:\n" + stderr); //this will contain more detailed debugging info
      });
  
      ffm.output(outputFile);
      // Store start time to calculate process time.
      var processStartTime = Date.now();
      ffm.on('end', function(data) {
        // When it's done transcoding it needs to be in the correct WebM Byte Stream format.
        child_process.execFile('mse_webm_remuxer', [outputFile, remuxFile], function(error, stdout, stderr) {
          fs.unlink(outputFile, function() {});
          if (error) {
            console.log(stdout);
            console.log(stderr);
            throw error;
          }
          callback(remuxFile, startTime, chunkSize);
          var callbacks = getProcessingListeners(remuxFile);
          removeProcessingFile(remuxFile);
          for (var j = 0; j < callbacks.length; j++) {
            callbacks[j](remuxFile, startTime, chunkSize);
          }
        });
      });
      console.log("starting " + remuxFile);
      ffm.run();
    }
  });
}

// Get video list
app.get('/video', function(req, res) {
  fs.readdir(path.resolve(__dirname, 'videos'), function(err, items) {
    var videos = [];
    for (var i = 0; i < items.length; i++) {
        var file = path.resolve(__dirname, 'videos', items[i]);
        videos.push(file);
    }
    res.send(videos);
  });
});

// Get video meta data.
app.get('/video/:video', function (req, res) {
  console.log('Getting video metadata: video is ' + req.params.video);
  ffmpeg.ffprobe(req.params.video, function(err, data) {
    if(err) {
      res.status(500).send('Could not probe video');
    } else {
      data.format.chunk_size = chunkSize;
      res.send(data);
    }
  });
});

// Get parts of video.
app.get('/video/:video/:part', function (req, res) {
  console.log('Getting video part (' + req.params.part + '): video is ' + req.params.video);
  getPart(req.params.video, req.params.part * chunkSize, function (data, startTime, duration) {
    res.sendFile(data);
  });
});

app.get('/', function (req, res) {
  res.sendFile(path.resolve(__dirname, 'index.html'));
});

app.listen(3000, function () {
  console.log('Example app listening on port 3000!');
});


