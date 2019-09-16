const AWS = require('aws-sdk');
const secrets = new AWS.SecretsManager();
const rp = require('request-promise');
const md5 = require('md5');
const { sendRollbarError } = require('utils');
let mailChimpKey;

exports.handler = async (event, context) => {
  // Log the event argument for debugging and for use in local development.
  console.log(JSON.stringify(event, undefined, 2));

  try {
    const response = await mailchimpFunction(event);

    return {
      statusCode: 200,
      headers: {},
      body: JSON.stringify(response)
    };
  } catch (error) {
    // Send a Rollbar error if an error occurs anywhere in the function
    await sendRollbarError(process.env.ROLLBAR_TOKEN, process.env.ENV, error.message, error);
    throw error;
  }
};

const mailchimpFunction = async (event) => {
  const notification = JSON.parse(event.Records[0].body);
  const type = notification.MessageAttributes.type.Value;
  const payload = JSON.parse(notification.Message);
  const mailChimpAudience = process.env.MAILCHIMP_AUDIENCE;

  const hashedEmail = md5(payload.email.toLowerCase());

  if (!mailChimpKey) {
    try {
      const { SecretString } = await secrets.getSecretValue({ SecretId: `${process.env.SECRETS_NAMESPACE}mailchimp-api-key` }).promise();
      mailChimpKey = SecretString;
    } catch (error) {
      console.error(`ERROR GETTING SECRET: ${JSON.stringify(error, undefined, 2)}`);
      throw error;
    }
  }
  
  if (type !== 'deployed-3x') {
    console.log(`UNHANDLED EVENT TYPE: ${type}`);
    return;
  }
  
  try {
    const response = await rp({
      method: 'post',
      headers: { Authorization: `Bearer ${mailChimpKey}` },
      uri: `https://us18.api.mailchimp.com/3.0/lists/${mailChimpAudience}/members`,
      json: true,
      body: {
        'email_address': payload.email,
        'status': 'subscribed',
        'merge_fields': {
          'FNAME': payload.firstName,
          'LNAME': payload.lastName
        },
        tags: [ 'send-swag' ]
      }
    });
    
    console.log(`${type.toUpperCase()} SUCCESS: ${JSON.stringify(response, undefined, 2)}`);
    
    return response;
  } catch (error) {
    console.error(`${type.toUpperCase()} ERROR: ${JSON.stringify(error, undefined, 2)}`);
    
    throw error;
  }
}
