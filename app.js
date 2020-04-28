const express = require('express'),
  mongoose = require('mongoose'),
  path = require('path'),
  dotenvconf = require('dotenv').config(),
  app = express(),
  cron = require('node-cron'),
  mailer = require('@sendgrid/mail'),
  api = require('covidapi'),
  got = require('got')

require('./models')
const User = mongoose.model("User")

if(dotenvconf.error || !process.env.NODE_ENV || !process.env.HTTP_PORT || !process.env.MONGO_URL || !process.env.SESSION_SECRET || !process.env.SENDGRID_APIKEY){
  console.error('invalid environment variables, please fix your .env file')
  process.exit(-1)
}

mailer.setApiKey(process.env.SENDGRID_APIKEY);
mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true})
const isProduction = process.env.NODE_ENV === 'production'

app.set('views', path.join(__dirname, '/views'))
app.set('view engine', 'ejs')

app.use(require('morgan')(':date[web] | :remote-addr - :method :url :status :response-time ms - :res[content-length]'))
app.use(require('cookie-parser')())
app.use(express.json())
app.use(express.urlencoded({extended: false}))
app.use(require('express-session')({ name: 'linkr-session', secret: process.env.SESSION_SECRET, cookie: { maxAge: parseInt(process.env.MAX_COOKIE_AGE) || 36e5}, resave: false, saveUninitialized: true, httpOnly: true}))
app.use(express.static(path.join(__dirname, '/public')))
app.use(require('helmet')())

app.get('/', async (req, res, next) => res.render("index", { unregistered: req.session.unregistered, user: req.session.user, error: req.session.err, data: (await getCountries()).map(c => c.name)}))

app.use((req, res, next) => {
  delete req.session.user
  delete req.session.unregistered
  delete req.session.err
  next()
})

app.post('/register', async (req, res, next) => {
  const { country, email} = req.body
  var response = JSON.parse((await got(`http://apilayer.net/api/check?access_key=a7477d475c7e05f32078ebec882e806d&email=${email}`)).body)
  if(response.mx_found && response.smtp_check){
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
          newU.save(async (err)=> {
            req.session.user = newU
            console.log(`${email} subscribed to mails for ${country}`)
            res.redirect('/#signup')
            let info = (await api.countries({country}))
            info["caseIncrease"] = parseFloat((info.cases/(info.cases-info.todayCases)*100-100).toFixed(2))
            info["deathIncrease"] = parseFloat((info.deaths/(info.deaths-info.todayDeaths)*100-100).toFixed(2))
            mailer.send({
              to: [email],
              from: "subscribed@covid19dailydigest.com",
              dynamic_template_data: {
                country: country,
                totalCases: info.cases,
                activeCases: info.active,
                activeCasesPercent: parseFloat((info.active / info.cases * 100).toFixed(2)),
                totalDeaths: info.deaths,
                totalDeathsPercent: parseFloat((info.deaths / info.cases * 100).toFixed(2)),
                totalRecovered: info.recovered,
                totalRecoveredPercent: parseFloat((info.recovered / info.cases * 100).toFixed(2)),
                todayCases: info.todayCases,
                todayCasesIncrease: (info.caseIncrease >= 0 ? "+":"-")+info.caseIncrease,
                todayDeaths: info.todayDeaths,
                todayDeathsIncrease: (info.deathIncrease >= 0 ? "+":"-")+info.deathIncrease,
                userEmail: email,
                countrySlug: country.toLowerCase().replace(/ /g, '-')
              },
              templateId: "d-7c65e6469d0d44f9aad9fb18666d3678"
            })
          })
        }else{
          req.session.err = 'Invalid Email.'
          res.redirect('/#signup')
        }
      }
    })
  }else{
    req.session.err = 'Invalid Email.'
    res.redirect('/#signup')
  }
})

app.get('/unregister', (req, res, next) => {
  const { email, country } = req.query
  User.findOne({
    email, country: country.toLowerCase().replace(/ /g, '-')
  }, async (err, user) => {
    if (err) return next(err)
    if (user) {
      console.log(`${email} unsubscribed from mails for ${country}`)
      user.remove()
      req.session.unregistered = true
      req.session.user = null
      res.redirect('/#signup')
      mailer.send({
        to: [email],
        from: "unsubscribed@covid19dailydigest.com",
        dynamic_template_data: {
          country: (await getCountries()).find(c => c.slug === country).name
        },
        templateId: "d-7887262dd5c94092aebb98c695620cfc"
      })
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

async function getCountries(){
  return (await api.countries()).map(c => ({name: c.country, slug: c.country.toLowerCase().replace(/ /g, '-')}))
}

app.use((err, req, res, next) => {
  console.error(new Date().toISOString(), err)
  res.locals.message = err.message
  res.locals.error = !isProduction ? err : {}
  res.status(err.status || 5e2).send({error: err.message})
})

app.listen(process.env.HTTP_PORT, () => console.log(`listening on port ${process.env.HTTP_PORT}`))

cron.schedule("0 15 19 * * *", async () =>{
  console.log(new Date())
  var countries = await api.countries();
  var yesterdayData = await api.yesterday.countries();
  Promise.all(countries.map(c => 
    new Promise((resolve, reject) => User.find({country: c.slug}, (err, users) => err && reject(err) || !err && resolve({country:c, users})))))
    .then(data => {
      Promise.all(data.filter(d => d.users.length > 0).map(async d => 
        new Promise(async (resolve, reject) => {
          var obj = { country: d.country, users: d.users, stats: countries.find(c => c.country === d.country.name), yesterday: yesterdayData.find(c => c.country === d.country.name) }
          obj.stats["todayRecovered"] = obj.stats.recovered - obj.yesterday.recovered
          obj.stats["todayTests"] = obj.stats.tests - obj.yesterday.tests
          obj.stats["casesIncrease"] = parseFloat((obj.stats.cases/(obj.stats.cases-obj.stats.todayCases)*100-100).toFixed(2))
          obj.stats["deathsIncrease"] = parseFloat((obj.stats.deaths/(obj.stats.deaths-obj.stats.todayDeaths)*100-100).toFixed(2))
          obj.stats["recoveredIncrease"] = parseFloat((obj.stats.recovered/(obj.stats.recovered-obj.stats.todayRecovered)*100-100).toFixed(2))
          obj.stats["testsIncrease"] = parseFloat((obj.stats.tests/(obj.stats.tests-obj.stats.todayTests)*100-100).toFixed(2))
          obj.yesterday["casesIncrease"] = parseFloat((obj.yesterday.cases/(obj.yesterday.cases-obj.yesterday.todayCases)*100-100).toFixed(2))
          obj.yesterday["deathsIncrease"] = parseFloat((obj.yesterday.deaths/(obj.yesterday.deaths-obj.yesterday.todayDeaths)*100-100).toFixed(2))
          obj.yesterday["recoveredIncrease"] = parseFloat((obj.yesterday.recovered/(obj.yesterday.recovered-obj.yesterday.todayRecovered)*100-100).toFixed(2))
          obj.yesterday["testsIncrease"] = parseFloat((obj.yesterday.tests/(obj.yesterday.tests-obj.yesterday.todayTests)*100-100).toFixed(2))
          resolve(obj)
    }))).then(mails => {
      for(var mail of mails){
        mailer.send({
          personalizations: mail.users.map(u => ({
            to: [{email: u.email}], 
            subject: `COVID19 Daily Digest for ${mail.stats.country}`,
            dynamic_template_data: { 
              country: mail.country.name,
              totalCases: mail.stats.cases,
              yesterdayTotalCases: mail.yesterday.cases,
              activeCases: mail.stats.active,
              yesterdayActiveCases: mail.yesterday.active,
              activeCasesPercent: parseFloat((mail.stats.active / mail.stats.cases * 100).toFixed(2)),
              yesterdayActiveCasesPercent: parseFloat((mail.yesterday.active / mail.yesterday.cases * 100).toFixed(2)),
              totalDeaths: mail.stats.deaths,
              yesterdayTotalDeaths: mail.yesterday.deaths,
              totalDeathsPercent: parseFloat((mail.stats.deaths / mail.stats.cases * 100).toFixed(2)),
              yesterdayTotalDeathsPercent: parseFloat((mail.yesterday.deaths / mail.yesterday.cases * 100).toFixed(2)),
              totalRecovered: mail.stats.recovered,
              yesterdayTotalRecovered: mail.yesterday.recovered,
              totalRecoveredPercent: parseFloat((mail.stats.recovered / mail.stats.recovered * 100).toFixed(2)),
              yesterdayTotalRecoveredPercent: parseFloat((mail.yesterday.recovered / mail.yesterday.cases * 100).toFixed(2)),
              totalTests: mail.stats.tests,
              yesterdayTotalTests: mail.yesterday.tests,
              todayCases: mail.stats.todayCases,
              yesterdayCases: mail.yesterday.todayCases,
              todayCasesIncrease: (mail.stats.casesIncrease >= 0 ? "+":"-")+mail.stats.casesIncrease,
              todayRecovered: mail.stats.todayRecovered,
              yesterdayRecovered: mail.yesterday.todayRecovered,
              todayRecoveredIncrease: (mail.stats.recoveredIncrease >= 0 ? "+":"-")+mail.stats.recoveredIncrease,
              todayDeaths: mail.stats.todayDeaths,
              yesterdayDeaths: mail.yesterday.todayDeaths,
              todayDeathsIncrease: (mail.stats.deathsIncrease >= 0 ? "+":"-")+mail.stats.deathsIncrease,
              todayTests: mail.stats.todayTests,
              yesterdayTests: mail.yesterday.todayTests,
              todayTestsIncrease: (mail.stats.testsIncrease >= 0 ? "+":"-")+mail.stats.testsIncrease,
              criticalCases: mail.stats.critical,
              criticalCasesPercent: parseFloat((mail.stats.critical / mail.stats.cases * 100).toFixed(2)),
              casesPerMillion: mail.stats.casesPerOneMillion,
              deathsPerMillion: mail.stats.deathsPerOneMillion,
              testsPerMillion: mail.stats.testsPerOneMillion,
              infectionRate: parseFloat((mail.stats.casesPerOneMillion/1000000*100).toFixed(5)),
              deathRate: parseFloat((mail.stats.deathsPerOneMillion/1000000*100).toFixed(5)),
              testRate: parseFloat((mail.stats.testsPerOneMillion/1000000*100).toFixed(5)),
              userEmail: u.email,
              countrySlug: mail.country.slug
            }
          })),
          from: mail.country.slug+'@covid19dailydigest.com',
          templateId: 'd-e178db6964e74919b1796070a2142e73',
        })
        console.log(`Sent report for ${mail.country.name} to ${mail.users.map(u=>u.email).join(", ")}`)
      }
    })
  })
})