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
  fs = require('fs')

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
    email, country
  }, (err, user) => {
    if (err) return next(err)
    if (user) {
      req.session.err = 'This Email has already been used to register for that country.'
      res.redirect('/#signup')
    }else{
      if(validateEmailAddress(email)){
        let newU = new User({email, country})
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
  console.log(email,country)
  User.findOne({
    email, country
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
    request("https://api.covid19api.com/countries", null, (err, data) => {
      if(err) 
        reject(err)
      else
        resolve(JSON.parse(data.body))
    })
  })
}

function getStats(country){
  return Promise.all(["confirmed", "recovered", "deaths"].map(status => new Promise((resolve, reject) => {
    request(`https://api.covid19api.com/total/dayone/country/${country}/status/${status}`, null, (err, data) => {
      if(err) 
        reject(err)
      else
        resolve(JSON.parse(data.body))
    })
  })))
}

app.use((err, req, res, next) => {
  res.locals.message = err.message
  res.locals.error = !isProduction ? err : {}
  res.status(err.status || 5e2).send({error: err.message})
})

http.createServer(app).listen(process.env.HTTP_PORT, () => console.log(`listening on port ${process.env.HTTP_PORT}`))

if(process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH)
  https.createServer({ key: fs.readFileSync(path.resolve(process.env.SSL_KEY_PATH), 'utf8'), cert: fs.readFileSync(path.resolve(process.env.SSL_CERT_PATH), 'utf8')}, app).listen(process.env.HTTPS_PORT, () => console.log(`listening on port ${process.env.HTTPS_PORT}`))


cron.schedule("0 15 20 * * *", ()=>{
  console.log(new Date())
  getCountries().then(data => {
    Promise.all(data.map(c => new Promise((resolve, reject) => {
      User.find({
        country: c.Slug
      }, (err, users) => {
        if(err)
          reject(err)
        else 
          resolve({country: {name: c.Country, slug: c.Slug}, users})
      })
    }))).then(res => {
      res = res.filter(x => x.users.length > 0)
      Promise.all(res.map(o => new Promise((resolve, reject) => {
        getStats(o.country.slug).then(stats => {
          let obj = {
            country: o.country, 
            users: o.users, 
            confirmed: stats[0] || [], 
            recovered: stats[1] || [], 
            deaths: stats[2] || [],
          }
          obj["firstConfirmed"] = Date.parse((obj.confirmed[0] || [])["Date"] || null)
          obj["firstRecovery"] = Date.parse((obj.recovered[0] || [])["Date"] || null)
          obj["firstDeath"] = Date.parse((obj.deaths[0] || [])["Date"] || null)
          obj["totalConfirmed"] = (obj.confirmed[obj.confirmed.length-1] || [])["Cases"] || 0
          obj["totalRecoveries"] = (obj.recovered[obj.recovered.length-1] || [])["Cases"] || 0
          obj["totalDeaths"] = (obj.deaths[obj.deaths.length-1] || [])["Cases"] || 0
          obj["increaseConfirmed"] = parseFloat((((obj.confirmed[obj.confirmed.length-1] || [])["Cases"]/(obj.confirmed[obj.confirmed.length-2] || [])["Cases"]*100)-100).toFixed(3))
          obj["increaseRecoveries"] = parseFloat((((obj.recovered[obj.recovered.length-1] || [])["Cases"]/(obj.recovered[obj.recovered.length-2] || [])["Cases"]*100)-100).toFixed(3))
          obj["increaseDeaths"] = parseFloat((((obj.deaths[obj.deaths.length-1] || [])["Cases"]/(obj.deaths[obj.deaths.length-2] || [])["Cases"]*100)-100).toFixed(3))
          obj["increaseConfirmedNum"] = ((obj.confirmed[obj.confirmed.length-1] || [])["Cases"]-(obj.confirmed[obj.confirmed.length-2] || [])["Cases"])
          obj["increaseRecoveriesNum"] = ((obj.recovered[obj.recovered.length-1] || [])["Cases"]-(obj.recovered[obj.recovered.length-2] || [])["Cases"])
          obj["increaseDeathsNum"] = ((obj.deaths[obj.deaths.length-1] || [])["Cases"]-(obj.deaths[obj.deaths.length-2] || [])["Cases"])
          resolve(obj)
        }).catch(err => reject(err))
      }))).then(res => {
        for(var obj of res){
          mailer.send({
            personalizations: obj.users.map(u => ({
              to: [{email:u.email}], 
              subject: `COVID19 Daily Digest for ${obj.country.name}`, 
              substitutionWrappers: [':', ''], 
              substitutions: { "user_email": u.email, "country_name": obj.country.slug },
              dynamic_template_data: { 
                country: obj.country.name,
                firstConfirmed: Math.floor(Math.abs(moment.duration(moment(obj.firstConfirmed).diff(moment())).asDays())) || 0,
                firstConfirmedDate: isNaN(new Date(obj.firstConfirmed).getTime()) ? "N/A" : new Date(obj.firstConfirmed).toLocaleDateString(),
                firstRecovery: Math.floor(Math.abs(moment.duration(moment(obj.firstRecovery).diff(moment())).asDays())) || 0,
                firstRecoveryDate: isNaN(new Date(obj.firstRecovery).getTime()) ? "N/A" : new Date(obj.firstRecovery).toLocaleDateString(),
                firstDeath: Math.floor(Math.abs(moment.duration(moment(obj.firstDeath).diff(moment())).asDays())) || 0,
                firstDeathDate: isNaN(new Date(obj.firstDeath).getTime()) ? "N/A" : new Date(obj.firstDeath).toLocaleDateString(),
                totalConfirmed: obj.totalConfirmed,
                totalRecoveries: obj.totalRecoveries,
                totalDeaths: obj.totalDeaths,
                increaseConfirmed: obj.increaseConfirmed || 0,
                increaseRecoveries: obj.increaseRecoveries || 0,
                increaseDeaths: obj.increaseDeaths || 0,
                increaseConfirmedNum: obj.increaseConfirmedNum || 0,
                increaseRecoveriesNum: obj.increaseRecoveriesNum || 0,
                increaseDeathsNum: obj.increaseDeathsNum || 0,
                userEmail: u.email,
                countrySlug: obj.country.slug
              }
            })),
            from: 'daily-digest@covid19.com',
            templateId: 'd-370c448d35d84873b2331072594c6842',
          })
          console.log(`Sent report for ${obj.country.name} to ${obj.users.map(u=>u.email).join(", ")}`)
        }
      })
    })
  }) 
})