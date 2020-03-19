const express = require('express'),
  mongoose = require('mongoose'),
  path = require('path'),
  dotenvconf = require('dotenv').config(),
  request = require('request')
  app = express(),
  cron = require('node-cron'),
  mailer = require('@sendgrid/mail'),
  moment = require('moment'),
  http = require('http'),
  https = require('https'),
  fs = require('fs'),
  rp = require('request-promise')

require('./models')
mailer.setApiKey(process.env.SENDGRID_APIKEY);
const User = mongoose.model("User")

if(dotenvconf.error || !process.env.NODE_ENV || !process.env.HTTP_PORT || !process.env.MONGO_URL){
  console.log('invalid environment variables, please fix your .env file')
  process.exit(-1)
}

mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true})
const isProduction = process.env.NODE_ENV === 'production'

app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

app.use(`/.well-known/acme-challenge/${process.env.CERTBOT_KEY}`, (req, res, next) => res.send(process.env.CERTBOT_TOKEN))

app.use(require('morgan')(':date[web] | :remote-addr - :method :url :status :response-time ms - :res[content-length]'))
app.use(require('cookie-parser')())
app.use(express.json())
app.use(express.urlencoded({extended: false}))
app.use(require('express-session')({ name: 'linkr-session', secret: process.env.SESSION_SECRET, cookie: { maxAge: parseInt(process.env.MAX_COOKIE_AGE) || 36e5}, resave: false, saveUninitialized: true, httpOnly: true}))
app.use(express.static(path.join(__dirname, '/public')))
app.use(require('helmet')())

if(isProduction)
  app.use((req, res, next) => {
    if(req.secure)
      next()
    else
      res.redirect(`https://${req.hostname}${req.path}`)
  })

app.get('/', (req, res, next) => getCountries().then((data) => res.render("index", { unregistered: req.session.unregistered, user: req.session.user, error: req.session.err, data})).catch((err)=>res.status(500).send(err)))

app.use((req, res, next) => {
  delete req.session.user
  delete req.session.unregistered
  delete req.session.err
  next()
})

app.post('/register', (req, res, next) => {
  const { country, email} = req.body
  User.findOne({
    email, country: country.toLowerCase().replace(/ /g, '-')
  }, (err, user) => {
    if (err) return next(err)
    if (user) {
      req.session.err = 'This Email has already been used to register for that country.'
      res.redirect('/#signup')
    }else{
      if(validateEmailAddress(email)){
        let newU = new User({email, country: country.toLowerCase().replace(/ /g, '-')})
        newU.save((err)=> {
          req.session.user = newU
          res.redirect('/#signup')
        })
      }else{
        req.session.err = 'Invalid Email.'
        res.redirect('/#signup')
      }
    }
  })
})

app.get('/unregister', (req, res, next) => {
  const { email, country } = req.query
  User.findOne({
    email, country: country.toLowerCase().replace(/ /g, '-')
  }, (err, user) => {
    if (err) return next(err)
    if (user) {
      user.remove()
      req.session.unregistered = true
      req.session.user = null
      res.redirect('/#signup')
    }else{
      req.session.err = 'This Email is not registered for that country.'
      res.redirect('/#signup')
    }
  })
})

function validateEmailAddress(email) {
  var expression = /(?!.*\.{2})^([a-z\d!#$%&'*+\-\/=?^_`{|}~\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+(\.[a-z\d!#$%&'*+\-\/=?^_`{|}~\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+)*|"((([ \t]*\r\n)?[ \t]+)?([\x01-\x08\x0b\x0c\x0e-\x1f\x7f\x21\x23-\x5b\x5d-\x7e\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]|\\[\x01-\x09\x0b\x0c\x0d-\x7f\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))*(([ \t]*\r\n)?[ \t]+)?")@(([a-z\d\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]|[a-z\d\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF][a-z\d\-._~\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]*[a-z\d\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])\.)+([a-z\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]|[a-z\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF][a-z\d\-._~\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]*[a-z\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])\.?$/i;
  return expression.test(String(email).toLowerCase());
}

function getCountries(){
  return new Promise((resolve, reject) => {
    resolve(JSON.parse(fs.readFileSync(path.join(__dirname, '/countries.json'))))
  })
}

function getStats(){
  return rp("https://pomber.github.io/covid19/timeseries.json", {json: true})
}

app.use((err, req, res, next) => {
  res.locals.message = err.message
  res.locals.error = !isProduction ? err : {}
  res.status(err.status || 5e2).send({error: err.message})
})

http.createServer(app).listen(process.env.HTTP_PORT, () => console.log(`listening on port ${process.env.HTTP_PORT}`))

if(process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH)
  https.createServer({ key: fs.readFileSync(path.resolve(process.env.SSL_KEY_PATH), 'utf8'), cert: fs.readFileSync(path.resolve(process.env.SSL_CERT_PATH), 'utf8')}, app).listen(process.env.HTTPS_PORT, () => console.log(`listening on port ${process.env.HTTPS_PORT}`))


//cron.schedule("0 15 20 * * *", ()=>{
  console.log(new Date())
  getCountries().then(countries => {
    Promise.all(countries.map(country => new Promise((resolve, reject) => {
      User.find({
        country: country.toLowerCase().replace(/ /g, '-')
      }, (err, users) => {
        if(err)
          reject(err)
        else 
          resolve({country, users})
      })
    }))).then(data => {
      data = data.filter(d => d.users.length > 0)
      getStats().then(stats => {
        Promise.all(data.map(d => new Promise((resolve, reject) => {
          var obj = {
            country: d.country,
            users: d.users,
            stats: stats[d.country]
          }
          console.log(obj)
          obj["firstConfirmed"] = Date.parse((obj.stats.filter(s => s.confirmed > 0)[0] || {}).date)
          obj["firstRecovery"] = Date.parse((obj.stats.filter(s => s.recovered > 0)[0] || {}).date)
          obj["firstDeath"] = Date.parse((obj.stats.filter(s => s.deaths > 0)[0] || {}).date)
          obj["totalConfirmed"] = obj.stats[obj.stats.length-1].confirmed
          obj["totalRecoveries"] = obj.stats[obj.stats.length-1].recovered
          obj["totalDeaths"] = obj.stats[obj.stats.length-1].deaths
          obj["increaseConfirmed"] = parseFloat(((obj.totalConfirmed / obj.stats[obj.stats.length-2].confirmed * 100)-100).toFixed(3))
          obj["increaseRecoveries"] = parseFloat(((obj.totalRecoveries / obj.stats[obj.stats.length-2].recovered * 100)-100).toFixed(3))
          obj["increaseDeaths"] = parseFloat(((obj.totalDeaths / obj.stats[obj.stats.length-2].deaths * 100)-100).toFixed(3))
          obj["increaseConfirmedNum"] = obj.totalConfirmed - obj.stats[obj.stats.length-2].confirmed
          obj["increaseRecoveriesNum"] = obj.totalRecoveries - obj.stats[obj.stats.length-2].recovered
          obj["increaseDeathsNum"] = obj.totalDeaths - obj.stats[obj.stats.length-2].deaths
          resolve(obj)
        }))).then(data => {
          for(var obj of data){
            console.log({ 
              country: obj.country,
              firstConfirmed: Math.floor(Math.abs(moment.duration(moment(obj.firstConfirmed).diff(moment())).asDays())) || 0,
              firstConfirmedDate: isNaN(new Date(obj.firstConfirmed).getTime()) ? "N/A" : new Date(obj.firstConfirmed).toLocaleDateString(),
              firstRecovery: Math.floor(Math.abs(moment.duration(moment(obj.firstRecovery).diff(moment())).asDays())) || 0,
              firstRecoveryDate: isNaN(new Date(obj.firstRecovery).getTime()) ? "N/A" : new Date(obj.firstRecovery).toLocaleDateString(),
              firstDeath: Math.floor(Math.abs(moment.duration(moment(obj.firstDeath).diff(moment())).asDays())) || 0,
              firstDeathDate: isNaN(new Date(obj.firstDeath).getTime()) ? "N/A" : new Date(obj.firstDeath).toLocaleDateString(),
              totalConfirmed: obj.totalConfirmed,
              totalRecoveries: obj.totalRecoveries,
              totalDeaths: obj.totalDeaths,
              increaseConfirmed: obj.increaseConfirmed,
              increaseRecoveries: obj.increaseRecoveries,
              increaseDeaths: obj.increaseDeaths,
              increaseConfirmedNum: obj.increaseConfirmedNum,
              increaseRecoveriesNum: obj.increaseRecoveriesNum,
              increaseDeathsNum: obj.increaseDeathsNum,
              users: obj.users,
              countrySlug: obj.country.toLowerCase().replace(/ /g, '-')
            })
            continue;
            mailer.send({
              personalizations: obj.users.map(u => ({
                to: [{email:u.email}], 
                subject: `COVID19 Daily Digest for ${obj.country}`,
                dynamic_template_data: { 
                  country: obj.country,
                  firstConfirmed: Math.floor(Math.abs(moment.duration(moment(obj.firstConfirmed).diff(moment())).asDays())) || 0,
                  firstConfirmedDate: isNaN(new Date(obj.firstConfirmed).getTime()) ? "N/A" : new Date(obj.firstConfirmed).toLocaleDateString(),
                  firstRecovery: Math.floor(Math.abs(moment.duration(moment(obj.firstRecovery).diff(moment())).asDays())) || 0,
                  firstRecoveryDate: isNaN(new Date(obj.firstRecovery).getTime()) ? "N/A" : new Date(obj.firstRecovery).toLocaleDateString(),
                  firstDeath: Math.floor(Math.abs(moment.duration(moment(obj.firstDeath).diff(moment())).asDays())) || 0,
                  firstDeathDate: isNaN(new Date(obj.firstDeath).getTime()) ? "N/A" : new Date(obj.firstDeath).toLocaleDateString(),
                  totalConfirmed: obj.totalConfirmed,
                  totalRecoveries: obj.totalRecoveries,
                  totalDeaths: obj.totalDeaths,
                  increaseConfirmed: obj.increaseConfirmed,
                  increaseRecoveries: obj.increaseRecoveries,
                  increaseDeaths: obj.increaseDeaths,
                  increaseConfirmedNum: obj.increaseConfirmedNum,
                  increaseRecoveriesNum: obj.increaseRecoveriesNum,
                  increaseDeathsNum: obj.increaseDeathsNum,
                  userEmail: u.email,
                  countrySlug: obj.country.toLowerCase().replace(/ /g, '-')
                }
              })),
              from: obj.country.toLowerCase().replace(/ /g, '-')+'@covid19dailydigest.com',
              templateId: 'd-370c448d35d84873b2331072594c6842',
            })
            console.log(`Sent report for ${obj.country} to ${obj.users.map(u=>u.email).join(", ")}`)
          }
        }).catch(console.log)
      }).catch((e) => console.log("err: "+e))
    }).catch(console.log)
  })
//})