/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var express = require('express'),
  app = express(),
  bluemix = require('./config/bluemix'),
  extend = require('util')._extend,
  watson = require('watson-developer-cloud'),
  async  = require('async'),
  favicon = require('serve-favicon');

// Bootstrap application settings
require('./config/express')(app);

app.use(favicon(__dirname + '/public/images/favicon.ico'));

// if bluemix credentials exists, then override local
// To run this locally, you have to create an environment
// variable called VCAP_SERVICES that contains the JSON
// object that has the service credentials in it.
var credentials = extend(
	{version: 'v2'},
	bluemix.getServiceCreds('concept_insights')); // VCAP_SERVICES
console.log(credentials);

// Create the service wrapper
var conceptInsights = watson.concept_insights(credentials);
console.log(conceptInsights.accounts);

var corpus_id="";
var graph_id  = process.env.GRAPH_ID ||  '/graphs/wikipedia/en-20120601';

var accountID=conceptInsights.accounts.getAccountsInfo({},
		function(error,body,response)
			{
			if (error)
				{
				console.log(error);
				console.log("Terminating.");
				process.exit(-1);
				}
			else
				{
				accountID=body.accounts[0].account_id;
				console.log(accountID);
				corpus_id = process.env.CORPUS_ID || '/corpora/'+accountID+'/solutionExplorer';  //'/corpora/public/TEDTalks';
				}
			});

app.get('/api/labelSearch', function(req, res, next) {
  var params = extend({
    corpus: corpus_id,
    prefix: true,
    limit: 10,
    concepts: true
  }, req.query);

  conceptInsights.corpora.searchByLabel(params, function(err, results) {
    if (err)
      return next(err);
    else
      {
      console.log(results);
      res.json(results);
      }
  });
});

app.get('/api/conceptualSearch', function(req, res, next) {
  var params = extend({ corpus: corpus_id, limit: 10 }, req.query);
  conceptInsights.corpora.getRelatedDocuments(params, function(err, data) {
    if (err)
      return next(err);
    else {
      async.parallel(data.results.map(getPassagesAsync), function(err, documentsWithPassages) {
        if (err)
          return next(err);
        else{
          data.results = documentsWithPassages;
          res.json(data);
        }
      });
    }
  });
});

app.post('/api/extractConceptMentions', function(req, res, next) {
  var params = extend({ graph: graph_id }, req.body);
  conceptInsights.graphs.annotateText(params, function(err, results) {
    if (err)
      return next(err);
    else
      res.json(results);
  });
});

/**
 * Builds an Async function that get a document and call crop the passages on it.
 * @param  {[type]} doc The document
 * @return {[type]}     The document with the passages
 */
var getPassagesAsync = function(doc) {
  return function (callback) {
    conceptInsights.corpora.getDocument(doc, function(err, fullDoc) {
      if (err)
        callback(err);
      else {
        doc = extend(doc, fullDoc);
        doc.explanation_tags.forEach(crop.bind(this, doc));
        doc.url=getURL(doc); //091615dep
        delete doc.parts;
        callback(null, doc);
      }
    });
  };
};

//091615dep
function getURL(doc)
	{
	var url=null;
	for (var obj in doc.parts)
		{
		if (doc.parts[obj].name=="url")
			{
			url=doc.parts[obj].data;
			break;
			}
		}
	return url;
	}

/**
 * Crop the document text where the tag is.
 * @param  {Object} doc The document.
 * @param  {Object} tag The explanation tag.
 */
var crop = function(doc, tag){
  var textIndexes = tag.text_index;
  var documentText = doc.parts[tag.parts_index].data;

  var anchor = documentText.substring(textIndexes[0], textIndexes[1]);
  var left = Math.max(textIndexes[0] - 100, 0);
  var right = Math.min(textIndexes[1] + 100, documentText.length);

  var prefix = documentText.substring(left, textIndexes[0]);
  var suffix = documentText.substring(textIndexes[1], right);

  var firstSpace = prefix.indexOf(' ');
  if ((firstSpace !== -1) && (firstSpace + 1 < prefix.length))
      prefix = prefix.substring(firstSpace + 1);

  var lastSpace = suffix.lastIndexOf(' ');
  if (lastSpace !== -1)
    suffix = suffix.substring(0, lastSpace);

  tag.passage = '...' + prefix + '<b>' + anchor + '</b>' + suffix + '...';
};

// error-handler settings
require('./config/error-handler')(app);

var port = process.env.VCAP_APP_PORT || 3000;
app.listen(port);
console.log('listening at:', port);