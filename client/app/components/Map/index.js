import React, { Component } from 'react'
import style from './style.css'
import glStyle from './buildings.json'
import OverlayButton from '../OverlayButton'
import FilterButton from '../FilterButton'
import SearchBox from '../SearchBox/index.js'
import { bindActionCreators } from 'redux'
import { connect } from 'react-redux'
import * as MapActions from '../../actions/map'
import { bboxPolygon, area, erase } from 'turf'
import { debounce } from 'lodash'
import regionToCoords from './regionToCoords'

// leaflet plugins
import * as _leafletmapboxgljs from '../../libs/leaflet-mapbox-gl.js'
import * as _leafleteditable from '../../libs/Leaflet.Editable.js'

var map // Leaflet map object
var glLayer // mapbox-gl layer
var boundsLayer = null // selected region layer
var moveDirectly = false

class Map extends Component {
  render() {
    const { map, view, actions } = this.props
    return (
      <div className={view+'View'}>
        <div id="map"></div>
        <SearchBox className="searchbox" selectedRegion={map.region} {...actions}/>
        <span className="search-alternative">or</span>
        <button className="outline" onClick={::this.setViewportRegion}>Outline Custom Area</button>
        <FilterButton enabledFilters={map.filters} {...actions}/>
        <OverlayButton enabledOverlay={map.overlay} {...actions}/>
      </div>
    )
  }

  componentDidMount() {
    if (process.env.NODE_ENV !== 'production') {
      //glStyle.sources['osm-buildings-aggregated'].tiles[0] = glStyle.sources['osm-buildings-aggregated'].tiles[0].replace('52.50.120.37', 'localhost')
      //glStyle.sources['osm-buildings-raw'].tiles[0] = glStyle.sources['osm-buildings-raw'].tiles[0].replace('52.50.120.37', 'localhost')
    }

    map = L.map(
      'map', {
      editable: true,
      minZoom: 0
    })
    .setView([0, 35], 2)
    L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        zIndex: -1
    }).addTo(map);
    map.zoomControl.setPosition('bottomright')

    map.on('editable:editing', debounce(::this.setCustomRegion, 200))

    var token = 'pk.eyJ1IjoidHlyIiwiYSI6ImNpbHhyNWlxNDAwZXh3OG01cjdnOHV0MXkifQ.-Bj4ZYdiph9V5J8XpRMWtw';
    glLayer = L.mapboxGL({
      updateInterval: 0,
      accessToken: token,
      style: glStyle,
      hash: false
    }).addTo(map)

    if (this.props.region) {
      this.props.actions.setRegionFromUrl(this.props.region)
      moveDirectly = true
    }
    if (this.props.filters) {
      this.props.actions.setFiltersFromUrl(this.props.filters)
    }
    if (this.props.overlay) {
      this.props.actions.setOverlayFromUrl(this.props.overlay)
    }
  }

  componentWillReceiveProps(nextProps) {
    // ceck for changed url parameters
    if (nextProps.region !== this.props.region) {
      this.props.actions.setRegionFromUrl(nextProps.region)
    }
    if (nextProps.filters !== this.props.filters) {
      this.props.actions.setFiltersFromUrl(nextProps.filters)
    }
    if (nextProps.overlay !== this.props.overlay) {
      this.props.actions.setOverlayFromUrl(nextProps.overlay)
    }
    // check for changed map parameters
    if (nextProps.map.region !== this.props.map.region) {
      this.mapSetRegion(nextProps.map.region)
    }
    // check for changed time/experience filter
    if (nextProps.stats.timeFilter !== this.props.stats.timeFilter) {
      this.setTimeFilter(nextProps.stats.timeFilter)
    }
    if (nextProps.stats.experienceFilter !== this.props.stats.experienceFilter) {
      this.setExperienceFilter(nextProps.stats.experienceFilter)
    }
  }

  setViewportRegion() {
    var pixelBounds = map.getPixelBounds()
    var paddedLatLngBounds = L.latLngBounds(
      map.unproject(
        pixelBounds.getBottomLeft().add([30,-(20+212)])
      ),
      map.unproject(
        pixelBounds.getTopRight().subtract([30,-(70+52)])
      )
    ).pad(-0.15)
    this.props.actions.setRegion({
      type: 'bbox',
      coords: paddedLatLngBounds
        .toBBoxString()
        .split(',')
        .map(Number)
    })
  }

  setCustomRegion() {
    if (!boundsLayer) return
    this.props.actions.setRegion({
      type: 'polygon',
      coords: boundsLayer.toGeoJSON().geometry.coordinates[0].slice(0,-1)
    })
  }

  mapSetRegion(region) {
    var oldGeometry = null
    if (boundsLayer !== null) {
      oldGeometry = boundsLayer.toGeoJSON();
      map.removeLayer(boundsLayer)
    }
    if (region === null) return
    boundsLayer = L.polygon(regionToCoords(region, 'leaflet'), {
      weight: 1,
      color: 'gray'
    }).addTo(map)
    boundsLayer.enableEdit()

    // set map view to region
    try { // geometry calculcation are a bit hairy for invalid geometries (which may happen during polygon editing)
      let viewPort = bboxPolygon(map.getBounds().toBBoxString().split(',').map(Number))
      let xorAreaViewPort = erase(viewPort, boundsLayer.toGeoJSON())
      let fitboundsFunc
      if (moveDirectly) {
        fitboundsFunc = ::map.fitBounds
        moveDirectly = false
      } else if (
        !xorAreaViewPort // new region fully includes viewport
        || area(xorAreaViewPort) > area(viewPort)*(1-0.1) // region is small compared to current viewport (<10% of the area covered) or feature is outside current viewport
      ) {
        fitboundsFunc = ::map.flyToBounds
      } else {
        fitboundsFunc = () => {}
      }
      fitboundsFunc(boundsLayer.getBounds(), {
        paddingTopLeft: [20, 10+52],
        paddingBottomRight: [20, 10+212]
      })
    } catch(e) {}
  }

  setTimeFilter(timeFilter) {
    if (timeFilter === null) {
      // reset time filter
      glLayer._glMap.setFilter('buildings-raw-highlight', ["==", "_timestamp", -1])
    } else {
      glLayer._glMap.setFilter('buildings-raw-highlight', ["all",
        [">=", "_timestamp", timeFilter[0]],
        ["<=", "_timestamp", timeFilter[1]]
      ])
    }
  }

  setExperienceFilter(experienceFilter) {
    if (experienceFilter === null) {
      // reset time filter
      glLayer._glMap.setFilter('buildings-raw-highlight', ["==", "_userExperience", -1])
    } else {
      glLayer._glMap.setFilter('buildings-raw-highlight', ["all",
        [">=", "_userExperience", experienceFilter[0]],
        ["<=", "_userExperience", experienceFilter[1]]
      ])
    }
  }

}



function mapStateToProps(state) {
  return {
    map: state.map,
    stats: state.stats
  }
}

function mapDispatchToProps(dispatch) {
  return {
    actions: bindActionCreators(MapActions, dispatch)
  }
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Map)
